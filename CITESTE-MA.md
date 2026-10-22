# Car Lookup + Ofertă asigurare (demo)

## Pornire (cel mai simplu)
Dublu-click pe **start.bat**. La prima pornire instalează singur ce trebuie, apoi pornește.
Deschizi în browser: http://localhost:3000

(Varianta cu terminal: `npm install` o dată, apoi `node server.js`.)

## Fluxul
index (DriveCover) → Get a car quote → About the car (număr înmatriculare) →
detalii mașină → Continue → cover → nume → data nașterii → permis →
email → adresă → oraș → cod poștal → Review → Confirm & pay.

La "Confirm & pay" polița se trimite pe emailul introdus de client.

## Email (ca să plece polițele)
Completează în fișierul `.env` datele SMTP. Cel mai simplu, Gmail:
1. Cont Google → Security → activează **2-Step Verification**.
2. Tot acolo → **App passwords** → generează o parolă de aplicație (16 caractere).
3. În `.env`:
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=adresa_ta@gmail.com
   SMTP_PASS=parola_de_aplicatie
   SENDER_EMAIL=adresa_ta@gmail.com
   SENDER_NAME=DriveCover
4. Repornești. La pornire trebuie să scrie `Email: activ`.

Merge cu orice SMTP (Outlook: smtp-mail.outlook.com port 587, Brevo: smtp-relay.brevo.com port 587 etc.). Vezi `.env.example`.

## Detalii mașină (DVLA/MOT)
Token-ul Apify e deja pus în `.env`. Fără el pornește în mod demo.
