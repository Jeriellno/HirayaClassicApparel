# QA harness

Browser-driven checks for the garment cutout, person-photo gate, and the virtual
try-on flow. These are developer tools, not part of the app — nothing under
`src/` imports them. They live here (rather than the old root `_qa_archive/`)
so the repo root stays clean and the gates that caught real defects stay
runnable.

```bash
cd hiraya-frontend
node qa/gates/qa_gate_suite.mjs
```

## `gates/` — the ones worth re-running

| Script | Question it answers |
|---|---|
| `qa_gate_suite.mjs` | Runs the whole gate set in one command |
| `qa_real_garment_gate.mjs` | Does a real uploaded garment pass the shape gate? |
| `qa_garment_gate_e2e.mjs` | The same, end-to-end through the browser |
| `qa_body_photo_gate.mjs` | Is the body-photo requirement enforced on upload? |
| `qa_person_accepted.mjs` | Is a submitted person photo actually accepted? |
| `qa_person_wiring.mjs` | Is the accepted photo wired through to the render? |
| `qa_isnet_probe.mjs` | Does the ISNet matting call behave as expected? |

## `diagnostics/` — one-off probes kept for reference

`run_tryon_qa.mjs`, `_hf_tryon_e2e.mjs`, `qa_extract_check.mjs`,
`qa_cutout_purity.mjs`, `qa_garment_shape.mjs`, `qa_figure_classifier.mjs`,
`qa_silhouette_trace.mjs`, `qa_mask_art.mjs`, `qa_stage1_matte.mjs`,
`qa_toggle.mjs`, `qa_heart.mjs`, `qa_bag.mjs`, `qa_composite.mjs`,
`qa_verify_fast.mjs`, `qa_tryon_constraints.mjs`, `check_extract.mjs`,
`verify_extract.mjs`, `verify_final.mjs`, `analyse_sources.mjs`,
`_qa_mount.mjs`, plus the recorded traces `qa_garment_profile.json` and
`qa_silhouette_trace.json`.

## `fixtures/`

Base64 image fixtures (`bag`, `barong`, `person`) used by the scripts above.
They are inputs, not output, so they are committed.

## Output is not committed

The scripts write screenshots and reports next to themselves. Everything
`*.png`, `*.jpg` and generated `*.json` under `_qa_archive/` is ignored —
regenerate it rather than committing it. The old `_qa_archive/` folder is kept
on disk as a scratch area and is ignored by git.

## Browser profile

The Chromium profile these runs use (`.qa-chrome-profile/` in the repo root) is
git-ignored. It is a real browser profile — cookies, cache, history — and must
never be committed.
