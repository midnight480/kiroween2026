---
inclusion: always
---

# Working with the AWS account safely

- Deploy only to the owner's demo account, only with the owner's approval for that specific stack, and tell them what it costs first.
  RDS, NAT gateways, load balancers, EKS and ElastiCache cost money; SQS, SNS and small Fargate tasks are nearly free.
- Prefer `cobf diff` (a ChangeSet that is never executed and is always deleted) to check that CloudFormation accepts a template.
- After any real deployment: verify it works, then destroy it, then confirm nothing is left (stacks, load balancers, instances, RDS and
  snapshots, volumes, Elastic IPs, NAT gateways, log groups, secrets) in every region used. Say so explicitly.
- A failing stack can end in `ROLLBACK_FAILED` or `DELETE_FAILED`; report it honestly, never as "restored". Clean up with
  `delete-stack --deletion-mode FORCE_DELETE_STACK` only when the stack holds no real resources.
- Never print, log, commit or put in a demo screen the AWS account ID, a profile name that contains it, an access key, or a secret value.
  Errors must show the error name, not credentials. The browser must never receive AWS credentials: it only compiles.
- Do not commit `.env` files, keys or tokens. Steering and spec files are part of the repository.
- Pin dependencies to exact versions.
