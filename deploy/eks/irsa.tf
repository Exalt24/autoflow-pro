# IAM Roles for Service Accounts (IRSA): the cluster's OIDC issuer is registered as an IAM identity provider,
# and the worker's role trusts exactly one Kubernetes service account through it. A pod running as that
# service account gets short lived credentials for this role, with no access key stored anywhere.

resource "aws_iam_openid_connect_provider" "eks" {
  url            = aws_eks_cluster.this.identity[0].oidc[0].issuer
  client_id_list = ["sts.amazonaws.com"]
}

locals {
  oidc_host = replace(aws_iam_openid_connect_provider.eks.url, "https://", "")
}

data "aws_iam_policy_document" "worker_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.eks.arn]
    }

    # Only this service account in this namespace, and only tokens minted for STS.
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = ["system:serviceaccount:${var.k8s_namespace}:${var.k8s_service_account}"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "worker" {
  name               = "${var.cluster_name}-worker"
  assume_role_policy = data.aws_iam_policy_document.worker_assume.json
}

# Same access the deploy/aws IAM user has: objects under the archive prefix, and listing that prefix. Nothing else.
data "aws_iam_policy_document" "worker_archive" {
  statement {
    sid       = "ObjectsUnderArchivePrefix"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:GetObjectVersion", "s3:DeleteObjectVersion"]
    resources = ["arn:${local.partition}:s3:::${var.archive_bucket_name}/${var.archive_prefix}*"]
  }

  statement {
    sid       = "ListArchivePrefix"
    actions   = ["s3:ListBucket", "s3:ListBucketVersions"]
    resources = ["arn:${local.partition}:s3:::${var.archive_bucket_name}"]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${var.archive_prefix}*"]
    }
  }
}

resource "aws_iam_policy" "worker_archive" {
  name        = "${var.cluster_name}-worker-archive"
  description = "Archive prefix access for the AutoFlow Pro worker pods"
  policy      = data.aws_iam_policy_document.worker_archive.json
}

resource "aws_iam_role_policy_attachment" "worker_archive" {
  role       = aws_iam_role.worker.name
  policy_arn = aws_iam_policy.worker_archive.arn
}
