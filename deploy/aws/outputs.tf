output "bucket_name" {
  value = aws_s3_bucket.archive.id
}

output "bucket_arn" {
  value = aws_s3_bucket.archive.arn
}

output "policy_arn" {
  value = aws_iam_policy.archive_access.arn
}

output "iam_user_name" {
  value = aws_iam_user.archive_writer.name
}

output "access_key_id" {
  value = one(aws_iam_access_key.archive_writer[*].id)
}

output "access_key_secret" {
  value     = one(aws_iam_access_key.archive_writer[*].secret)
  sensitive = true
}
