# IP location database (DB-IP Lite): monthly refresh

DB-IP Lite (CC BY 4.0; attribution "IP Geolocation by DB-IP", https://db-ip.com) is published on the 1st of each month. In the first week of each month, run on a machine with the lane or release database:

`IP_DB_DATABASE_URL=<local postgres URL> npx tsx scripts/ip-db/refresh-dbip.ts --data-dir C:\guidebuoy-backups\ip-data` (downloads the month's city and ASN files outside the repo, converts them, loads them and marks the edition current; prints counts and hashes only).

The script loads local databases only. Loading the hosted databases is a release step for Elena, using the same `ip-db.csv` and `ip-db.meta.json` from `<data-dir>/<YYYY-MM>/build/`. Packs keep the database date with each lookup, so older editions are not needed after a refresh.
