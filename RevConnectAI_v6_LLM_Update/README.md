# RevConnectAI v6 LLM Update Package

This package contains the LLM-specific files needed to upgrade the current v5 repository:
- revconnect_llm.py — grounded natural-language/reasoning layer
- LLM_INTEGRATION.md — exact integration steps
- .env.example — server-side configuration template
- requirements-llm.txt — additional Python dependencies
- RevConnectAI_Knowledge_Base_v4/ — updated 2026–27 handbook and Payment Request form

The LLM is intentionally not given web search. Institutional answers remain grounded in
retrieved knowledge-base evidence; the LLM is used for natural conversation, interpretation,
and logical application of that evidence.

This is an update package for the current repository, not a replacement for the repository's
CampusGroups client, UI, retrieval index, tests, or Cloudflare files.
