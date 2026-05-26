# Infrastructure-as-code

Executable form of the architecture documented in [`../DEPLOYMENT.md`](../DEPLOYMENT.md).

Two variants, the same VPC/RDS/ECS/KMS foundation underneath, deliberately divergent at the ingress edge:

```
infra/
├── modules/                One source of truth for VPC, RDS, ECS, KMS,
│                           Secrets Manager. Re-used by both variants.
│
├── public-internet/        Vercel-hosted Next.js + ECS Fargate Hermes
│                           behind a public ALB + WAF. Customer-managed
│                           DNS, CloudFront, ACM. The "fastest to ship"
│                           topology. Egress to LLM providers via NAT.
│
└── private-vpc/            ECS Fargate Next.js + ECS Fargate Hermes,
                            both on an internal ALB. No public ingress.
                            Reached via VPN, Direct Connect, or a
                            customer-owned reverse proxy. Egress optionally
                            via VPC endpoints (PrivateLink) to bypass NAT.
```

## Which variant?

| Question | Public-internet | Private-VPC |
|---|---|---|
| "Can our customers reach the app over the public internet?" | Yes (via Vercel) | No (intranet only) |
| "Does our team's traffic ever leave AWS?" | Yes (browser → Vercel → AWS) | No (browser → Direct Connect → AWS) |
| "Do we need an AWS WAF in front of the app?" | Yes | Optional (intranet) |
| "How fast can we deploy v1?" | ~1 day | ~3–5 days (more networking) |
| "Cost per month, idle?" | ~$140 (NAT + RDS + 1 Fargate) | ~$200 (extra Fargate for app + optional endpoints) |
| "Are we SOC-2 / HIPAA-bound?" | Possible, more controls | Easier story for auditors |

If you don't know which fits, start with `public-internet/` and migrate later — the database, KMS, secrets, and ECS service definitions are the same modules, so the migration is "redeploy the app to ECS, point DNS at the internal ALB."

## Conventions used everywhere

- **Region:** `us-east-1` by default; override via `var.region`.
- **Naming:** every resource is prefixed with `${var.name_prefix}-` (default `kindcaddy`) so an account can host multiple environments side by side (`kindcaddy-staging`, `kindcaddy-prod`).
- **Tagging:** all resources receive `Project = kindcaddy`, `Environment = var.environment`, `ManagedBy = terraform`. AWS Cost Explorer can slice by these.
- **State:** examples below assume an S3 backend + DynamoDB lock table. The backend block is intentionally left **commented out** in `versions.tf` so a fresh `terraform init` works without prior bootstrap; uncomment when you've provisioned the backend bucket.
- **Secrets in state:** Terraform state can contain secrets; encrypt the state bucket and restrict access to the deploy role.
- **No app images are built here.** ECS task definitions reference image URIs passed as variables (`var.hermes_image`, `var.app_image`). Build + push lives in CI (`.github/workflows/`); IaC only deploys.

## Quickstart

```bash
cd infra/public-internet      # or private-vpc

terraform init
terraform plan  -var-file=staging.tfvars
terraform apply -var-file=staging.tfvars
```

Each variant ships an `example.tfvars` with safe defaults; copy to `staging.tfvars` / `prod.tfvars` and adjust.

## What's intentionally out of scope

- **Route 53 hosted zone creation.** Provided as a `data` source so the customer keeps ownership of DNS. Add a `resource "aws_route53_zone"` if you want Terraform to own it.
- **ACM certificate validation.** The certificate is *requested* but DNS validation records must be created in whatever zone you point at us (often a separate account). The plan output prints what's needed.
- **GitHub OIDC trust policy.** Documented in [`../DEPLOYMENT.md`](../DEPLOYMENT.md) §5; not in IaC because the trust direction (GitHub → AWS) is best owned by the org's identity team.
- **CloudWatch dashboards and alarms.** Listed in `OPERATIONS.md` §2-3 with their queries; add as `aws_cloudwatch_metric_alarm` resources once your alerting destination (PagerDuty / Opsgenie / Slack) is known.

These omissions are deliberate: an opinionated piece of IaC that assumes the wrong identity provider or alerting target wastes more of the operator's time than a documented gap they can fill in 10 minutes.
