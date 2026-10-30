data "aws_caller_identity" "current" {
  count = var.bucket_suffix == null ? 1 : 0
}

locals {
  bucket_name = "${var.name_prefix}-${coalesce(var.bucket_suffix, one(data.aws_caller_identity.current[*].account_id))}"
}

resource "aws_s3_bucket" "archive" {
  bucket        = local.bucket_name
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_public_access_block" "archive" {
  bucket = aws_s3_bucket.archive.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "archive" {
  bucket = aws_s3_bucket.archive.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "archive" {
  bucket = aws_s3_bucket.archive.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "archive" {
  bucket = aws_s3_bucket.archive.id

  rule {
    id     = "expire-run-archives"
    status = "Enabled"

    filter {
      prefix = var.archive_prefix
    }

    expiration {
      days = var.archive_expiry_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_expiry_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.archive]
}

data "aws_partition" "current" {}

locals {
  bucket_arn = "arn:${data.aws_partition.current.partition}:s3:::${local.bucket_name}"
}

# Read, write and delete (including versions, since the bucket is versioned) on objects under the
# archive prefix, and list that prefix.
# Nothing else in the bucket and nothing outside it.
resource "aws_iam_policy" "archive_access" {
  name        = "${var.name_prefix}-policy"
  description = "Archive prefix access for the AutoFlow Pro backend"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ArchiveObjects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion", "s3:DeleteObject", "s3:DeleteObjectVersion"]
        Resource = "${local.bucket_arn}/${var.archive_prefix}*"
      },
      {
        Sid      = "ListArchivePrefix"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = local.bucket_arn
        Condition = {
          StringLike = { "s3:prefix" = ["${var.archive_prefix}*"] }
        }
      },
    ]
  })
}

resource "aws_iam_user" "archive_writer" {
  name = "${var.name_prefix}-user"
}

resource "aws_iam_user_policy_attachment" "archive_writer" {
  user       = aws_iam_user.archive_writer.name
  policy_arn = aws_iam_policy.archive_access.arn
}

resource "aws_iam_access_key" "archive_writer" {
  count = var.create_access_key ? 1 : 0
  user  = aws_iam_user.archive_writer.name
}
