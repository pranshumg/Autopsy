# Blind challenge: test AUTOPSY on a system it has never seen

The point of a blind challenge is that **someone other than the investigator** designs the scoring rules. AUTOPSY then works only from the public schema and the responses. Afterwards, the hidden rules are revealed and compared with the findings.

## For the challenge author (teammate or mentor)

1. Copy `examples/blind-challenge-server.mjs` (plain Node 18+, no dependencies).
2. Replace the example `score()` function with your own rules. Ideas that make a good test:
   - a threshold (a sudden jump at some value);
   - a smooth effect;
   - a categorical option that shifts the output;
   - an input that is deliberately ignored;
   - an interaction (one input matters only when another is high);
   - a little random noise.
3. Keep the rules secret. Write them down in plain sentences for the reveal, one per line.
4. Deploy it on a **public HTTPS URL** (e.g. Render, Railway, Fly.io, a Vercel function, or `cloudflared tunnel`/`ngrok` in front of your laptop). AUTOPSY's production relay refuses localhost and private IPs.
5. Share **only**: the endpoint URL, the API key, and the schema (field names, types, ranges/options). The server prints the schema JSON on startup, ready to paste into AUTOPSY.

## For the operator

1. Open **Connect a black box** (`/connect`), choose **Paste schema JSON**, paste the author's schema, and enter the credential.
2. Press **Test connection**. You should see a validated numeric result.
3. **Save & investigate.** Use the default budget, or the one agreed with the author.
4. When the run completes, open the rulebook, go to **Reveal ground truth**, paste the author's rules, and mark each one as recovered, partial or missed.
5. Export Markdown/JSON. The export includes the comparison and your verdicts.

## Honest reporting

- Findings are supported behavioral patterns, not recovered source code. "No detectable effect" means none was detected within the tested ranges and budget.
- The bundled sample challenge (`/api/challenge/loan-apr`) was written by AUTOPSY's authors. It demonstrates the workflow but is **not** independent validation.
- Report misses as well as hits, along with the budget used.
