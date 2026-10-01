# Cloud Run deployment

`cloudbuild.yaml` deploys `rng` from the `main` branch after the Dockerfile's
typecheck, tests, and TypeScript build succeed. The first successful deployment
creates the Cloud Run service. No build or deployment is started by adding these
files to the repository.

## Choose the region

The Google Cloud project is `godpack-app`. Its existing default Firestore
database is in `asia-east1`. Choose a Cloud Run and Artifact Registry region
before creating resources; `asia-east1` keeps this service near that database.
Use the same region for the Cloud Build trigger and the `_REGION` substitution.

The commands below use these variables after the region is chosen:

```sh
PROJECT_ID=godpack-app
REGION=YOUR_CHOSEN_REGION
RUNTIME_SA="rng-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA="rng-build@${PROJECT_ID}.iam.gserviceaccount.com"
```

## One-time project setup

1. Enable Cloud Build, Cloud Run, Artifact Registry, Secret Manager, and IAM.
   Secret Manager is currently disabled in `godpack-app`.

   ```sh
   gcloud services enable cloudbuild.googleapis.com run.googleapis.com \
     artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com \
     --project="$PROJECT_ID"
   ```

2. Create a Docker repository in the chosen region and two service accounts.
   The build account builds and deploys; the runtime account accesses Firestore
   and the API key.

   ```sh
   gcloud artifacts repositories create rng --repository-format=docker \
     --location="$REGION" --project="$PROJECT_ID"
   gcloud iam service-accounts create rng-runtime --project="$PROJECT_ID"
   gcloud iam service-accounts create rng-build --project="$PROJECT_ID"
   ```

3. Grant the runtime account Firestore read/write access. In the Secret Manager
   console, create `rng-api-key` with a strong random value as version `1`.
   Store the same key securely for the service that calls
   `POST /v1/draw-batches`. Never put it in source control or Cloud Build
   substitutions. Then grant the runtime account access to that secret.

   ```sh
   gcloud projects add-iam-policy-binding "$PROJECT_ID" \
     --member="serviceAccount:$RUNTIME_SA" --role=roles/datastore.user
   gcloud secrets add-iam-policy-binding rng-api-key --project="$PROJECT_ID" \
     --member="serviceAccount:$RUNTIME_SA" \
     --role=roles/secretmanager.secretAccessor
   ```

4. Give the build account Artifact Registry Writer on the `rng` repository,
   Cloud Run Admin and Logs Writer in the project, and Service Account User on
   `rng-runtime`. Cloud Build logs use Cloud Logging.

   ```sh
   gcloud artifacts repositories add-iam-policy-binding rng \
     --location="$REGION" --project="$PROJECT_ID" \
     --member="serviceAccount:$BUILD_SA" \
     --role=roles/artifactregistry.writer
   gcloud projects add-iam-policy-binding "$PROJECT_ID" \
     --member="serviceAccount:$BUILD_SA" --role=roles/run.admin
   gcloud projects add-iam-policy-binding "$PROJECT_ID" \
     --member="serviceAccount:$BUILD_SA" --role=roles/logging.logWriter
   gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
     --project="$PROJECT_ID" --member="serviceAccount:$BUILD_SA" \
     --role=roles/iam.serviceAccountUser
   ```

   If the GitHub connection stages source in a Cloud Storage bucket, also give
   `rng-build` read access to that bucket.

## Connect GitHub and create the trigger

Connect `godpack-app/rng` to Cloud Build's GitHub integration in the Google
Cloud console. After the region is chosen and the repository is connected,
create a trigger for `^main$` using `cloudbuild.yaml` and the `rng-build`
service account. Supply `_REGION` and `_RNG_SECRET_VERSION` as substitutions.
Create the trigger only when the next push to `main` should deploy.
For the first secret version, use:

```sh
gcloud builds triggers create github \
  --project="$PROJECT_ID" --region="$REGION" --name=rng-main \
  --repo-owner=godpack-app --repo-name=rng --branch-pattern='^main$' \
  --build-config=cloudbuild.yaml \
  --service-account="projects/$PROJECT_ID/serviceAccounts/$BUILD_SA" \
  --substitutions="_REGION=$REGION,_RNG_SECRET_VERSION=1"
```

The trigger builds an image tagged with the source commit SHA, pushes it to
`$REGION-docker.pkg.dev/$PROJECT_ID/rng/rng`, and deploys that image. A failed
typecheck, test, or build stops the pipeline before the push. Cloud Run receives
`RNG_API_KEY` from Secret Manager and uses `rng-runtime` as its identity, so no
service-account key file is needed. Cloud Run public access is enabled for the
verification endpoints; the draw-batch route still requires the bearer key.

If using a named Firestore database, set `FIRESTORE_DATABASE_ID` on the Cloud
Run service before sending traffic. For the existing default database, leave
it unset. After the first deployment, check `/health`, `/v1/head`, and the
Cloud Build logs. Independent checkpoint publishing remains unconfigured.
