resource "random_password" "admin" {
  length  = 32
  special = true
  # Scaleway rejects a few characters in database passwords; keep the set conservative.
  override_special = "-_=+"
}

resource "random_password" "app" {
  length           = 32
  special          = true
  override_special = "-_=+"
}

# The instance. `user_name`/`password` here create the ADMIN role, which owns the
# schema and runs migrations. The application does not use this role.
resource "scaleway_rdb_instance" "main" {
  name       = "bluedoor-${var.environment}"
  project_id = var.project_id
  region     = var.region

  engine    = var.engine
  node_type = var.node_type

  is_ha_cluster     = var.is_ha_cluster
  volume_type       = var.volume_type
  volume_size_in_gb = var.volume_size_in_gb

  # Cheap to turn on now, impossible to turn on retroactively without a restore.
  encryption_at_rest = true

  user_name = "bluedoor_admin"
  password  = random_password.admin.result

  disable_backup            = false
  backup_schedule_frequency = var.backup_schedule_frequency
  backup_schedule_retention = var.backup_schedule_retention
  backup_same_region        = true

  tags = ["bluedoor", var.environment, "managed-by:terraform"]

  lifecycle {
    # A destroyed database is a destroyed database. Remove this block deliberately
    # (and take a backup first) if you genuinely mean to tear the instance down.
    prevent_destroy = true
  }
}

# Default-deny. With an empty allowed_cidrs the instance accepts nothing, which is
# the intended failure mode — see the variable's note.
resource "scaleway_rdb_acl" "main" {
  instance_id = scaleway_rdb_instance.main.id

  dynamic "acl_rules" {
    for_each = var.allowed_cidrs
    content {
      ip          = acl_rules.value
      description = "bluedoor-${var.environment} allowed client"
    }
  }
}

resource "scaleway_rdb_database" "main" {
  instance_id = scaleway_rdb_instance.main.id
  name        = var.database_name
}

# Runtime role. Not admin — RLS only binds to roles that are neither superuser nor
# table owner. Table-level GRANTs for this role live in db/migrations/, because the
# database is the source of truth for who can touch what.
resource "scaleway_rdb_user" "app" {
  instance_id = scaleway_rdb_instance.main.id
  name        = var.app_user_name
  password    = random_password.app.result
  is_admin    = false
}

resource "scaleway_rdb_privilege" "app" {
  instance_id   = scaleway_rdb_instance.main.id
  user_name     = scaleway_rdb_user.app.name
  database_name = scaleway_rdb_database.main.name

  # Database-level connect privilege. The migrations narrow this down per table.
  permission = "all"
}
