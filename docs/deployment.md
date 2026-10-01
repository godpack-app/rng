# Cloud Run deployment

`cloudbuild.yaml` deploys `rng` after the Dockerfile's typecheck, tests, and
TypeScript build succeed. It can be submitted from a local checkout for the
first deployment, then run from a `main` branch trigger later. No build or
deployment is started by adding these files to the repository.

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

   ```sh
   gcloud services enable cloudbuild.googleapis.com run.googleapis.com \
     artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com \
     --project="$PROJECT_ID"
   ```

2. Create a Docker repository, a dedicated `rng-chain` Firestore database, and two
   service accounts. The build account builds and deploys; the runtime account
   accesses only the RNG database and API key.

   ```sh
   gcloud artifacts repositories create rng --repository-format=docker \
     --location="$REGION" --project="$PROJECT_ID"
   gcloud firestore databases create --database=rng-chain --location="$REGION" \
     --type=firestore-native --project="$PROJECT_ID"
   gcloud iam service-accounts create rng-runtime --project="$PROJECT_ID"
   gcloud iam service-accounts create rng-build --project="$PROJECT_ID"
   ```

3. Grant the runtime account Firestore read/write access only to the `rng-chain`
   database. In the Secret Manager console, create `rng-api-key` with a strong
   random value as version `1`.
   Store the same key securely for the service that calls
   `POST /v1/draw-batches`. Never put it in source control or Cloud Build
   substitutions. Then grant the runtime account access to that secret.

   ```sh
   gcloud projects add-iam-policy-binding "$PROJECT_ID" \
     --member="serviceAccount:$RUNTIME_SA" --role=roles/datastore.user \
     --condition='expression=resource.name=="projects/godpack-app/databases/rng-chain",title=RngDatabaseOnly,description=RNG database access'
   gcloud secrets add-iam-policy-binding rng-api-key --project="$PROJECT_ID" \
     --member="serviceAccount:$RUNTIME_SA" \
     --role=roles/secretmanager.secretAccessor
   ```

4. Give the build account Artifact Registry Writer on the `rng` repository,
   Logs Writer in the project, and Service Account User on `rng-runtime`.
   Cloud Build logs use Cloud Logging. Grant Cloud Run Developer on the `rng`
   service after the first deployment creates it.

   ```sh
   gcloud artifacts repositories add-iam-policy-binding rng \
     --location="$REGION" --project="$PROJECT_ID" \
     --member="serviceAccount:$BUILD_SA" \
     --role=roles/artifactregistry.writer
   gcloud projects add-iam-policy-binding "$PROJECT_ID" \
     --member="serviceAccount:$BUILD_SA" --role=roles/logging.logWriter \
     --condition=None
   gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
     --project="$PROJECT_ID" --member="serviceAccount:$BUILD_SA" \
     --role=roles/iam.serviceAccountUser
   ```

   If the GitHub connection stages source in a Cloud Storage bucket, also give
   `rng-build` read access to that bucket.

## First deployment from a local checkout

After committing the deployment files locally, submit the checkout to Cloud
Build. This project currently uses the Compute Engine default build account,
which already has the permissions needed for the initial Cloud Run creation.
The checkout is uploaded to Cloud Build, not pushed to GitHub. The image is
tagged with the local commit SHA. Run this only when ready to create a public
Cloud Run service and send traffic to it.

```sh
gcloud builds submit . --config=cloudbuild.yaml --project="$PROJECT_ID" \
  --region="$REGION" \
  --substitutions="COMMIT_SHA=$(git rev-parse HEAD),_REGION=$REGION,_RNG_SECRET_VERSION=1"
```

After a successful deployment, scope future build deployments to this service:

```sh
gcloud run services add-iam-policy-binding rng --region="$REGION" \
  --project="$PROJECT_ID" --member="serviceAccount:$BUILD_SA" \
  --role=roles/run.developer
```

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

The deployment sets `FIRESTORE_DATABASE_ID=rng-chain`; it does not write to the
existing default Firestore database. After the first deployment, check
`/health`, `/v1/head`, and the Cloud Build logs. Independent checkpoint
publishing remains unconfigured.
