# Agent instructions

## Personal data
- Never commit real case data: claimant or third-party names, amounts, bank or complaint references,
  police report numbers, flight details, uploaded file names, case outputs or model responses captured from a real case.
- Fixtures, baselines and test answer keys must be synthetic. Real-case expected values stay outside the repo
  (for example under `C:\guidebuoy-backups\regression\`) and are passed in through an env path; tests skip when it is unset.
- Never copy production or staging data into the repo, docs or evidence files. Report IDs and counts only.
- This repository is hosted on GitHub; treat everything committed as published.
