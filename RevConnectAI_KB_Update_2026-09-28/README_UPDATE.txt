RevConnectAI Knowledge Base Update — September 28, 2026

Files
-----
1. RSO_Handbook_2026_2027.pdf
   Updated 2026–2027 Registered Student Organization Handbook.

2. RevConnect_Payment_Request_Form_2026.pdf
   Updated RevConnect/CampusGroups Payment Request Form supplied for the knowledge base.

Where to put them
-----------------
Copy both PDF files into:

RevConnectAI_Knowledge_Base_v4/

The current RevConnectAI notebook loader recursively loads supported knowledge-base
files and includes PDF files, so no Python code change is required just to make these
two PDFs available to the local/notebook RAG knowledge base.

GitHub website method
---------------------
1. Open the revconnect-ai repository.
2. Open RevConnectAI_Knowledge_Base_v4.
3. Choose Add file > Upload files.
4. Upload both PDFs from this package.
5. Commit directly to main, or create a branch/PR if you prefer.

Git command-line method
-----------------------
git clone https://github.com/cjsrxzdyzds/revconnect-ai.git
cd revconnect-ai

# Copy the two PDFs into RevConnectAI_Knowledge_Base_v4/, then:
git add RevConnectAI_Knowledge_Base_v4/RSO_Handbook_2026_2027.pdf
git add RevConnectAI_Knowledge_Base_v4/RevConnect_Payment_Request_Form_2026.pdf
git commit -m "Update RevConnectAI knowledge base for 2026-27"
git push origin main

Important deployment note
-------------------------
The repository README states that the Cloudflare-hosted public web edition does not
run the notebook's local language/embedding models and does not make page-cited policy
claims from the source PDFs. Uploading these PDFs updates the notebook/local RAG
knowledge base. It does not by itself make the public Cloudflare website use them.

After updating, test questions such as:
- Can I reimburse a $700 purchase?
- Can I use Venmo to pay a vendor?
- How do I pay a DJ or speaker?
- How early should I submit a hotel request?
- What documentation should I attach to a payment request?
- Can I make the purchase before my request is approved?
