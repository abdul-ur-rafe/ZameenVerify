"""
Automated tests for pipeline.py. These assert the specific properties
verified empirically during development (see pipeline.py's module and
function docstrings) — they exist so a future change to stage order,
parameters, or the skew estimation algorithm doesn't silently
reintroduce bugs that were found and fixed during that process.

Run with: pytest test_pipeline.py -v
"""

import cv2
import numpy as np
import pytest

from pipeline import preprocess_legacy_scan, _estimate_skew_angle, _measure_ink_contrast


def make_line_structured_scan(skew_degrees: float = 4.5, seed: int = 42) -> np.ndarray:
    """A synthetic scan with strokes organized into horizontal text-
    line bands, then rotated by a known angle. This structure — strokes
    clustered along consistent y-positions, not scattered at random
    angles — is what makes skew detection well-posed in the first
    place: a real page of text has a dominant line direction to detect.
    An earlier version of this fixture used fully random-angle scattered
    strokes with no line structure, which is not representative of real
    documents and caused false test failures unrelated to real pipeline
    bugs (a Hough-transform-based line-angle detector has nothing
    coherent to detect in that case).

    This is still not real Urdu handwriting — it exists to validate the
    mechanical image-processing properties (deskew correctness, noise
    handling, contrast behavior) independent of script, which is what
    the bugs found during development were actually about. It is NOT a
    substitute for testing against real Nastaliq document scans before
    shipping.
    """
    img = np.full((600, 800, 3), 200, dtype=np.uint8)
    rng = np.random.default_rng(seed)
    for line_y in range(80, 550, 45):
        x = 60
        while x < 740:
            stroke_len = rng.integers(15, 35)
            y_jitter = rng.integers(-4, 4)
            cv2.line(
                img,
                (x, line_y + y_jitter),
                (x + stroke_len, line_y + y_jitter),
                (130, 128, 125),
                thickness=2,
            )
            x += stroke_len + rng.integers(5, 15)
    noise = rng.normal(0, 12, img.shape).astype(np.int16)
    img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    h, w = img.shape[:2]
    rotation_matrix = cv2.getRotationMatrix2D((w / 2, h / 2), skew_degrees, 1.0)
    img = cv2.warpAffine(img, rotation_matrix, (w, h), borderMode=cv2.BORDER_REPLICATE)
    return img


class TestSkewDetection:
    @pytest.mark.parametrize(
        "true_skew",
        [0.0, 2.0, 4.5, 8.0, 15.0, -10.0, -20.0],
    )
    def test_detects_skew_across_angle_range(self, true_skew):
        """The correction angle the pipeline should apply is the
        negation of the rotation that was applied to the fixture."""
        scan = make_line_structured_scan(skew_degrees=true_skew)
        gray = cv2.cvtColor(scan, cv2.COLOR_BGR2GRAY)
        detected = _estimate_skew_angle(gray)
        expected = -true_skew
        assert abs(detected - expected) < 2.0, (
            f"true_skew={true_skew}, expected correction={expected}, "
            f"got {detected}"
        )

    def test_does_not_return_frame_spanning_angle_after_deskew(self):
        """Regression test for the specific bug found during
        development: on a scan that's already been deskewed once (and
        so has a rotated white-fill border region), an earlier
        contour-based estimator could pick up the border boundary
        itself and return a nonsense ~90-degree angle."""
        scan = make_line_structured_scan(skew_degrees=4.5)
        gray = cv2.cvtColor(scan, cv2.COLOR_BGR2GRAY)
        angle = _estimate_skew_angle(gray)
        h, w = gray.shape
        rotation_matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        deskewed = cv2.warpAffine(
            gray, rotation_matrix, (w, h), borderValue=255, flags=cv2.INTER_CUBIC
        )
        residual = _estimate_skew_angle(deskewed)
        assert abs(residual) < 2.0, (
            f"residual skew after correction was {residual} — expected "
            f"near 0. A value near +/-90 indicates the frame-artifact "
            f"or axis-ambiguity bug is back."
        )

    def test_blank_image_returns_zero_without_error(self):
        blank = np.full((400, 400), 255, dtype=np.uint8)
        assert _estimate_skew_angle(blank) == 0.0

    def test_sparse_content_does_not_crash(self):
        sparse = np.full((400, 400), 200, dtype=np.uint8)
        cv2.line(sparse, (50, 200), (350, 205), 100, 3)
        result = _estimate_skew_angle(sparse)
        assert np.isfinite(result)


class TestFullPipeline:
    def test_binarized_output_is_not_noise_dominated(self):
        """Regression test for the specific bug found during
        development: running CLAHE before denoising amplified scan
        noise into the binarized output, producing ~40%+ black pixels
        (salt-and-pepper speckle) instead of clean sparse strokes."""
        scan = make_line_structured_scan()
        result = preprocess_legacy_scan(scan)
        black_fraction = (result.binarized == 0).mean()
        assert black_fraction < 0.15, (
            f"binarized output is {black_fraction:.1%} black pixels — "
            f"expected well under 15% for sparse strokes on a clean "
            f"background. This likely means noise is being amplified "
            f"before denoising, not after."
        )

    def test_output_shapes_match_input(self):
        scan = make_line_structured_scan()
        result = preprocess_legacy_scan(scan)
        expected_shape = scan.shape[:2]
        assert result.binarized.shape == expected_shape
        assert result.enhanced_grayscale.shape == expected_shape

    def test_binarized_output_is_actually_binary(self):
        scan = make_line_structured_scan()
        result = preprocess_legacy_scan(scan)
        unique_values = np.unique(result.binarized)
        assert set(unique_values.tolist()).issubset({0, 255})

    def test_handles_zero_skew_without_error(self):
        scan = make_line_structured_scan(skew_degrees=0.0)
        result = preprocess_legacy_scan(scan)
        assert result.binarized is not None

    def test_detected_skew_is_reported_and_reasonable(self):
        scan = make_line_structured_scan(skew_degrees=6.0)
        result = preprocess_legacy_scan(scan)
        assert abs(result.detected_skew_degrees - (-6.0)) < 2.0

    def test_ink_contrast_diagnostics_are_finite(self):
        """These are surfaced as diagnostics, not asserted to strictly
        increase — denoising can legitimately reduce raw percentile-
        based contrast at an intermediate stage while still producing
        a clean final binarization (verified during development: the
        module's actual output was correctly clean at ~2% black-pixel
        fraction despite an intermediate contrast dip). The value that
        actually matters for OCR quality is binarization cleanliness,
        covered by test_binarized_output_is_not_noise_dominated above."""
        scan = make_line_structured_scan()
        result = preprocess_legacy_scan(scan)
        assert np.isfinite(result.ink_contrast_before)
        assert np.isfinite(result.ink_contrast_after)
        assert result.ink_contrast_before > 0


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
