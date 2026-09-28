# RevConnectAI v6 LLM integration patch

The current v5 notebook already performs:
- document ingestion
- chunking
- SentenceTransformer embeddings
- FAISS retrieval
- intent routing
- source formatting
- CampusGroups read-only retrieval
- local FLAN-T5 generation

To add the new natural-reasoning LLM layer:

1. Add `revconnect_llm.py` to the repository root.
2. Add `openai>=1.0.0` to `RevConnectAI_v5_API_Prototype/requirements.txt`.
3. In the notebook import/setup cell, add:

    from revconnect_llm import generate_llm_answer

4. In `generate_grounded_answer(question, results, intent)`, replace the existing
   generator call with:

    try:
        return generate_llm_answer(
            question,
            results,
            local_generator=get_generator(),
        )
    except Exception:
        return extractive_concise_fallback(question, results)

5. Keep retrieval BEFORE generation. The LLM should receive the retrieved chunks rather
   than answer GW-specific questions from its pretrained memory.

6. Put the two updated PDFs in:
   `RevConnectAI_Knowledge_Base_v4/`

7. Configure:
   REVCONNECT_LLM_PROVIDER=openai
   REVCONNECT_LLM_MODEL=gpt-5-mini
   OPENAI_API_KEY=<server-side secret>

Do not put an API key in `public/app.js`, HTML, a committed .env file, or any browser-side code.

Important: the current Cloudflare static/public edition is not the same runtime as the
Python/notebook RAG app. The Python app needs a server-side deployment for the LLM-backed
assistant to be available to students on the public site.
