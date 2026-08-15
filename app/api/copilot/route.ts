// app/api/copilot/route.ts
//
// Free-form Q&A about the current document batch and audit result.
// Each call is a fresh LLM request carrying the full conversation
// history plus the batch/audit context as grounding — no separate
// memory/session state server-side, the client owns the conversation
// history and resends it each turn (same pattern as a typical chat UI).

import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
});

const COPILOT_SYSTEM_PROMPT = `
You are the ZameenVerify AI Copilot — an assistant embedded in a Pakistani land record
fraud-risk audit tool. A lawyer or due-diligence analyst is asking you questions about a
specific batch of documents and the audit result already computed for them.

GROUNDING RULES:
- Answer ONLY using the document records and audit result provided in context below. Do not
  invent facts, field values, or legal conclusions that aren't supported by that data.
- If asked something the provided data doesn't cover (e.g. "is this legally valid under
  Section X of the Land Revenue Act"), say plainly that you don't have that information rather
  than guessing at legal specifics you're not certain of.
- When explaining why something is flagged, reference the SPECIFIC field, value, or reasoning
  text that supports your answer — point to what's actually in the data, not a generic
  explanation of what that category of risk usually means.
- You are not a lawyer and this is not legal advice — if a question edges into "should I
  proceed with this transaction," note that briefly once, not preachy or repeated every message.

HOW TO ANSWER — THIS MATTERS AS MUCH AS ACCURACY:
- Write like a knowledgeable colleague answering a quick question in person, not like a report
  or a legal memo. Plain sentences, no headers, no bullet-point lists unless the person's
  question specifically asks for a list of multiple items.
- Default length: 2-4 sentences. Only go longer if the question genuinely has multiple distinct
  parts that each need an answer, or the person explicitly asks for more detail/a full
  breakdown.
- Lead with the actual answer in the first sentence. Don't warm up with "Great question" or
  restate what they asked before answering it.
- Cite ONE specific supporting detail (a field value, a reasoning line), not every piece of
  evidence you have — pick the most relevant one. If they want more, they'll ask a follow-up.
- No filler closers like "let me know if you have more questions" or "feel free to ask" — end
  when the answer is given.
`;

function riskLevelSummary(verification: any): string {
  if (!verification) return '(No audit has been run yet for this batch.)';
  return `Current risk_level: ${verification.risk_level}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, records, verification } = body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'No message provided.' }, { status: 400 });
    }
    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: 'No documents in the current batch to discuss.' }, { status: 400 });
    }

    const contextBlock = `
CURRENT DOCUMENT BATCH (${records.length} document${records.length > 1 ? 's' : ''}):
${JSON.stringify(records, null, 2)}

CURRENT AUDIT RESULT:
${verification ? JSON.stringify(verification, null, 2) : '(No audit has been run yet for this batch.)'}
`;

    // Cap conversation history sent to the model — keeps latency/cost
    // bounded on long sessions without needing real server-side memory.
    const MAX_HISTORY_MESSAGES = 20;
    const trimmedMessages = messages.slice(-MAX_HISTORY_MESSAGES);

    const chatMessages = [
      { role: 'system' as const, content: COPILOT_SYSTEM_PROMPT + '\n\n' + contextBlock },
      ...trimmedMessages.map((m: any) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: String(m.content || ''),
      })),
    ];

    const response = await openai.chat.completions.create({
      model: 'qwen-plus',
      temperature: 0.2,
      // Backstop for the brevity instruction above — 2-4 sentences of
      // plain prose comfortably fits in ~250 tokens with real headroom;
      // this isn't meant to bite under normal answers, just to prevent
      // the model from drifting into a long report-style response.
      max_tokens: 400,
      messages: chatMessages,
    });

    const reply = response.choices[0]?.message?.content || 'I was unable to generate a response. Please try again.';

    return NextResponse.json({ success: true, reply });
  } catch (error: any) {
    console.error('Unhandled error in /api/copilot:', error);
    return NextResponse.json(
      { error: 'The AI Copilot could not respond right now. Please try again.' },
      { status: 500 },
    );
  }
}
