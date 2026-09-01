# ReflectAI - User-Authenticated Journal & Multi-Turn Gemini Companion

ReflectAI is a secure, user-authenticated journaling and reflection platform built on Google Cloud, powered by **Gemini 3.6 Flash** and **Cloud Firestore**. Every reflection, prompt, and AI response is securely isolated strictly to the authenticated user using Firebase Authentication and Firestore Security Rules.

---

## 1. Architecture Overview

- **User Identity**: Firebase Authentication with Google Sign-In (federated passwordless identity; no raw credentials handled).
- **Database**: Cloud Firestore with owner-isolated security rules (`request.auth.uid == userId`).
- **AI Processing**: Gemini 3.6 Flash with a resilient multi-model fallback ladder (`gemini-3.6-flash` &rarr; `gemini-3.1-flash-lite` &rarr; `gemini-flash-latest` &rarr; `gemini-3.7-flash`).
- **Secret Management**: API keys and service configurations managed server-side via Google Cloud Secret Manager / Environment variables.
- **Frontend & Fullstack Runtime**: React 19 + TypeScript + Tailwind CSS served via an Express proxy backend with Vite.

---

## 2. Prerequisites & Cloud Setup

### 2.1 Google Cloud CLI Setup
Ensure you have the Google Cloud SDK (`gcloud`) installed and authenticated:
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

### 2.2 Enable Required APIs
Enable the necessary Google Cloud services:
```bash
gcloud services enable \
  run.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com \
  cloudbuild.googleapis.com
```

---

## 3. Secret Management Setup

### 3.1 Store Gemini API Key in Secret Manager
Create and populate the `GEMINI_API_KEY` secret in Google Cloud Secret Manager:
```bash
# Create the secret
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"

# Add your Gemini API key value
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets versions add GEMINI_API_KEY --data-file=-
```

### 3.2 Grant IAM Permissions to Cloud Run Service Account
Allow the default Compute Engine service account (or custom Cloud Run service account) to access the secret:
```bash
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')

gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

---

## 4. Cloud Firestore Security Rules

Deploy the owner-bound security rules to ensure zero cross-user data leakage:

```bash
# firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      match /entries/{entryId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
      
      match /sessions/{sessionId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
        
        match /messages/{messageId} {
          allow read, write: if request.auth != null && request.auth.uid == userId;
        }
      }
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Deploy with the Firebase CLI:
```bash
firebase deploy --only firestore:rules
```

---

## 5. Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables in `.env`:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   NODE_ENV=development
   ```

3. Start the dev server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

---

## 6. Cloud Run Deployment

Deploy directly from source to Google Cloud Run:

```bash
gcloud run deploy reflectai-app \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-secrets="GEMINI_API_KEY=GEMINI_API_KEY:latest" \
  --set-env-vars="NODE_ENV=production"
```

---

## 7. Security Mitigations Summary (OWASP & Threat Modeling)

| Threat Zone | Identified Risk | Implemented Countermeasure |
| :--- | :--- | :--- |
| **Input Surfaces** | Prompt injection / Malformed payloads | Strict schema validation, sanitization, defensive null-safe destructuring |
| **Database & Memory** | Cross-tenant data leakage | Firestore rules enforcing `request.auth.uid == userId` and zero `undefined` values |
| **Tool / AI Execution** | Model unavailability / Rate limits | 4-tier model fallback ladder with status-code error recovery |
| **Secrets & Keys** | Client-side API token leakage | Server-side Express proxy; keys never transmitted to client browser |
| **Authentication** | Credential stuffing / session hijacking | Passwordless Federated Google Identity via Firebase Auth |
