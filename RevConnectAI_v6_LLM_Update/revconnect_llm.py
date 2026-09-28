"""
RevConnectAI LLM layer.

Design goals:
- Institutional facts come from retrieved RevConnectAI knowledge-base evidence.
- The LLM may reason, summarize, clarify, and apply those facts naturally.
- No open-web search is used by this module.
- If evidence is insufficient for a GW-specific factual/policy claim, the assistant says so.
- Supports OpenAI-compatible APIs via environment variables, with local FLAN-T5 fallback.

Environment variables:
  REVCONNECT_LLM_PROVIDER=openai|local
  OPENAI_API_KEY=...
  REVCONNECT_LLM_MODEL=gpt-5-mini
  OPENAI_BASE_URL=https://api.openai.com/v1   # optional
"""

import os
from typing import Any, Dict, List, Optional

SYSTEM_PROMPT = """You are RevConnectAI, a George Washington University student-organization support assistant.

RULES
1. For GW, RevConnect, CampusGroups, student-organization, finance, funding, purchasing,
   reimbursement, contract, vendor, travel, event, and university-policy facts, use ONLY the
   supplied knowledge-base evidence and approved tool data.
2. You MAY use general reasoning to interpret a student's situation, connect facts in the
   evidence, explain rules in plain language, ask a useful follow-up question, brainstorm,
   summarize, and give non-institutional general guidance.
3. Never use or claim to use open-web information.
4. Never invent a GW rule, exception, deadline, approval, office procedure, price, organization,
   event, or system capability.
5. If the evidence does not establish a GW-specific answer, say that you cannot verify it from
   the current RevConnectAI knowledge base and direct the student to the appropriate office.
6. Distinguish a logical inference from a stated rule when that distinction matters.
7. RevConnectAI provides guidance, not final funding, purchasing, contract, reimbursement,
   travel, event, or policy decisions. Authorized GW staff and current official sources control.
8. Prefer a natural conversational answer over copying source text. Be concise unless the
   student asks for detail.
"""

def _evidence_text(results: List[Dict[str, Any]], limit: int = 6) -> str:
    blocks = []
    for i, item in enumerate(results[:limit], 1):
        title = item.get("document_title") or item.get("filename") or "Knowledge-base source"
        page = item.get("page_number")
        page_label = f", page {page}" if page not in (None, "", "nan") else ""
        source_type = item.get("source_type", "")
        text = item.get("text", "")
        blocks.append(f"[Evidence {i}: {title}{page_label}; {source_type}]\n{text}")
    return "\n\n".join(blocks)

def _openai_answer(question: str, results: List[Dict[str, Any]],
                   history: Optional[List[Dict[str, str]]] = None) -> str:
    from openai import OpenAI

    client = OpenAI(
        api_key=os.environ["OPENAI_API_KEY"],
        base_url=os.getenv("OPENAI_BASE_URL") or None,
    )
    model = os.getenv("REVCONNECT_LLM_MODEL", "gpt-5-mini")
    evidence = _evidence_text(results)

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for msg in (history or [])[-8:]:
        if msg.get("role") in {"user", "assistant"} and msg.get("content"):
            messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({
        "role": "user",
        "content": (
            f"Student question:\n{question}\n\n"
            f"Retrieved RevConnectAI evidence:\n{evidence or '[No relevant evidence retrieved]'}\n\n"
            "Answer the student's question naturally. For any GW-specific factual claim, remain "
            "grounded in the evidence. You may reason from the evidence, but do not invent policy."
        ),
    })

    response = client.chat.completions.create(
        model=model,
        messages=messages,
    )
    return (response.choices[0].message.content or "").strip()

def _local_answer(question: str, results: List[Dict[str, Any]], generator) -> str:
    evidence = _evidence_text(results, limit=4)
    prompt = f"""You are RevConnectAI.
Use the evidence for all GW-specific facts. You may reason from the evidence and explain it
naturally. Do not invent GW policy. If the evidence is insufficient, say so.

Question: {question}

Evidence:
{evidence or "[No relevant evidence retrieved]"}

Answer:"""
    output = generator(prompt, max_new_tokens=180, do_sample=False, truncation=True)
    return output[0]["generated_text"].strip()

def generate_llm_answer(question: str, results: List[Dict[str, Any]],
                        local_generator=None,
                        history: Optional[List[Dict[str, str]]] = None) -> str:
    provider = os.getenv("REVCONNECT_LLM_PROVIDER", "local").strip().lower()

    if provider == "openai":
        if not os.getenv("OPENAI_API_KEY"):
            raise RuntimeError(
                "REVCONNECT_LLM_PROVIDER is openai but OPENAI_API_KEY is not configured."
            )
        return _openai_answer(question, results, history=history)

    if local_generator is None:
        raise RuntimeError("Local LLM provider selected but no local generator was supplied.")
    return _local_answer(question, results, local_generator)
