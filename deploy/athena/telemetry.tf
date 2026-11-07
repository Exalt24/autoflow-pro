# Telemetry tables over the lake files that backend/src/telemetry writes. The layout is in backend/src/telemetry/lake.ts
# (PARTITION_TEMPLATES) and backend/tests/test-telemetry-terraform.ts checks that these tables, their columns and their
# projected locations are the ones the code writes.
#
#   readings      telemetry/readings/asset=<id>/dt=YYYY-MM-DD/hour=HH/part-<batch>.jsonl
#   rollup_5m     telemetry/rollups_5m/asset=<id>/dt=YYYY-MM-DD/rollup.jsonl
#   rollup_1h     telemetry/rollups_1h/asset=<id>/dt=YYYY-MM-DD/rollup.jsonl
#   quarantine    telemetry/quarantine/dt=YYYY-MM-DD/part-<batch>.jsonl
#
# Partition projection: dt is a date range up to NOW and hour is 00 to 23, so a new day or hour needs no crawler and no
# ADD PARTITION. asset is an injected projection, because a fleet has no fixed list of ids: every query on these tables
# must say which asset with an equality predicate (WHERE asset = 'pv-001'), and Athena then reads only that asset's folders.

locals {
  telemetry_reading_columns = [
    { name = "asset_id", type = "string" },
    { name = "ts", type = "string" },
    { name = "power_kw", type = "double" },
    { name = "voltage_v", type = "double" },
    { name = "temp_c", type = "double" },
  ]

  telemetry_rollup_columns = [
    { name = "asset_id", type = "string" },
    { name = "bucket_start", type = "string" },
    { name = "readings", type = "bigint" },
    { name = "power_kw_n", type = "bigint" },
    { name = "power_kw_min", type = "double" },
    { name = "power_kw_max", type = "double" },
    { name = "power_kw_mean", type = "double" },
    { name = "voltage_v_n", type = "bigint" },
    { name = "voltage_v_min", type = "double" },
    { name = "voltage_v_max", type = "double" },
    { name = "voltage_v_mean", type = "double" },
    { name = "temp_c_n", type = "bigint" },
    { name = "temp_c_min", type = "double" },
    { name = "temp_c_max", type = "double" },
    { name = "temp_c_mean", type = "double" },
    { name = "energy_kwh", type = "double" },
    { name = "gap_segments", type = "bigint" },
  ]

  telemetry_quarantine_columns = [
    { name = "reason", type = "string" },
    { name = "detail", type = "string" },
    { name = "asset_id", type = "string" },
    { name = "ts", type = "string" },
    { name = "raw", type = "string" },
  ]

  telemetry_base_parameters = {
    EXTERNAL                      = "TRUE"
    classification                = "json"
    "projection.enabled"          = "true"
    "projection.dt.type"          = "date"
    "projection.dt.format"        = "yyyy-MM-dd"
    "projection.dt.range"         = "${var.projection_start_day},NOW"
    "projection.dt.interval"      = "1"
    "projection.dt.interval.unit" = "DAYS"
  }

  telemetry_asset_parameters = {
    "projection.asset.type" = "injected"
  }

  telemetry_hour_parameters = {
    "projection.hour.type"   = "integer"
    "projection.hour.range"  = "0,23"
    "projection.hour.digits" = "2"
  }

  telemetry_lake_url = "s3://${aws_s3_bucket.lake.bucket}/${var.telemetry_prefix}"
}

# ---------------------------------------------------------------- the four tables

resource "aws_glue_catalog_table" "telemetry_readings" {
  name          = "telemetry_readings"
  database_name = aws_glue_catalog_database.events.name
  table_type    = "EXTERNAL_TABLE"

  parameters = merge(
    local.telemetry_base_parameters,
    local.telemetry_asset_parameters,
    local.telemetry_hour_parameters,
    { "storage.location.template" = "${local.telemetry_lake_url}readings/asset=$${asset}/dt=$${dt}/hour=$${hour}/" },
  )

  partition_keys {
    name = "asset"
    type = "string"
  }
  partition_keys {
    name = "dt"
    type = "string"
  }
  partition_keys {
    name = "hour"
    type = "string"
  }

  storage_descriptor {
    location      = "${local.telemetry_lake_url}readings/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hive.hcatalog.data.JsonSerDe"
    }

    dynamic "columns" {
      for_each = local.telemetry_reading_columns
      content {
        name = columns.value.name
        type = columns.value.type
      }
    }
  }
}

resource "aws_glue_catalog_table" "telemetry_rollup_5m" {
  name          = "telemetry_rollup_5m"
  database_name = aws_glue_catalog_database.events.name
  table_type    = "EXTERNAL_TABLE"

  parameters = merge(
    local.telemetry_base_parameters,
    local.telemetry_asset_parameters,
    { "storage.location.template" = "${local.telemetry_lake_url}rollups_5m/asset=$${asset}/dt=$${dt}/" },
  )

  partition_keys {
    name = "asset"
    type = "string"
  }
  partition_keys {
    name = "dt"
    type = "string"
  }

  storage_descriptor {
    location      = "${local.telemetry_lake_url}rollups_5m/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hive.hcatalog.data.JsonSerDe"
    }

    dynamic "columns" {
      for_each = local.telemetry_rollup_columns
      content {
        name = columns.value.name
        type = columns.value.type
      }
    }
  }
}

resource "aws_glue_catalog_table" "telemetry_rollup_1h" {
  name          = "telemetry_rollup_1h"
  database_name = aws_glue_catalog_database.events.name
  table_type    = "EXTERNAL_TABLE"

  parameters = merge(
    local.telemetry_base_parameters,
    local.telemetry_asset_parameters,
    { "storage.location.template" = "${local.telemetry_lake_url}rollups_1h/asset=$${asset}/dt=$${dt}/" },
  )

  partition_keys {
    name = "asset"
    type = "string"
  }
  partition_keys {
    name = "dt"
    type = "string"
  }

  storage_descriptor {
    location      = "${local.telemetry_lake_url}rollups_1h/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hive.hcatalog.data.JsonSerDe"
    }

    dynamic "columns" {
      for_each = local.telemetry_rollup_columns
      content {
        name = columns.value.name
        type = columns.value.type
      }
    }
  }
}

resource "aws_glue_catalog_table" "telemetry_quarantine" {
  name          = "telemetry_quarantine"
  database_name = aws_glue_catalog_database.events.name
  table_type    = "EXTERNAL_TABLE"

  parameters = merge(
    local.telemetry_base_parameters,
    { "storage.location.template" = "${local.telemetry_lake_url}quarantine/dt=$${dt}/" },
  )

  partition_keys {
    name = "dt"
    type = "string"
  }

  storage_descriptor {
    location      = "${local.telemetry_lake_url}quarantine/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hive.hcatalog.data.JsonSerDe"
    }

    dynamic "columns" {
      for_each = local.telemetry_quarantine_columns
      content {
        name = columns.value.name
        type = columns.value.type
      }
    }
  }
}

# ---------------------------------------------------------------- what the readers and the writer need

locals {
  telemetry_tables_arns = [
    "${local.glue_arn}:catalog",
    "${local.glue_arn}:database/${local.database_name}",
    "${local.glue_arn}:table/${local.database_name}/telemetry_readings",
    "${local.glue_arn}:table/${local.database_name}/telemetry_rollup_5m",
    "${local.glue_arn}:table/${local.database_name}/telemetry_rollup_1h",
    "${local.glue_arn}:table/${local.database_name}/telemetry_quarantine",
  ]
}

# Attach next to the query policy: that one runs the queries and writes the results, this one lets them see the four
# telemetry tables and read the telemetry files. Read only.
resource "aws_iam_policy" "telemetry_read" {
  name        = "${var.name_prefix}-telemetry-read"
  description = "Read the AutoFlow Pro telemetry tables and files"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadTheTelemetryTables"
        Effect   = "Allow"
        Action   = ["glue:GetDatabase", "glue:GetTable", "glue:GetPartitions"]
        Resource = local.telemetry_tables_arns
      },
      {
        Sid      = "ReadTheTelemetryFiles"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${local.lake_arn}/${var.telemetry_prefix}*"
      },
      {
        Sid       = "ListTheTelemetryFiles"
        Effect    = "Allow"
        Action    = ["s3:ListBucket"]
        Resource  = local.lake_arn
        Condition = { StringLike = { "s3:prefix" = ["${var.telemetry_prefix}*"] } }
      },
    ]
  })
}

# For the telemetry worker: write the files under the telemetry prefix and read them back when it starts. No delete
# anywhere: a part file is replaced by writing the same key again, and expiry is the lifecycle rule's job.
resource "aws_iam_policy" "telemetry_write" {
  name        = "${var.name_prefix}-telemetry-write"
  description = "Write and read back the AutoFlow Pro telemetry files"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "WriteTheTelemetryFiles"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:AbortMultipartUpload"]
        Resource = "${local.lake_arn}/${var.telemetry_prefix}*"
      },
      {
        Sid      = "ReadBackTheTelemetryFiles"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${local.lake_arn}/${var.telemetry_prefix}*"
      },
      {
        Sid       = "ListTheTelemetryFiles"
        Effect    = "Allow"
        Action    = ["s3:ListBucket"]
        Resource  = local.lake_arn
        Condition = { StringLike = { "s3:prefix" = ["${var.telemetry_prefix}*"] } }
      },
    ]
  })
}
