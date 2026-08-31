# --- Credentials (values go in scaleway.auto.tfvars — gitignored) -----------
variable "access_key" {
  type        = string
  sensitive   = true
  description = "Scaleway API access key (the SCWxxxx half of the pair)."
}

variable "secret_key" {
  type        = string
  sensitive   = true
  description = "Scaleway API secret key. Keep out of chat/git; rotate if exposed."
}

variable "organization_id" {
  type        = string
  description = "Scaleway organization ID."
}

variable "project_id" {
  type        = string
  description = "Scaleway project ID that owns the database instance."
}

# --- Placement --------------------------------------------------------------
variable "region" {
  type        = string
  default     = "fr-par"
  description = "Scaleway region. fr-par = Paris, nl-ams = Amsterdam. Both EU."
}

variable "environment" {
  type        = string
  default     = "dev"
  description = "Environment name, used in resource names and tags."
}

# --- Instance sizing --------------------------------------------------------
variable "engine" {
  type        = string
  default     = "PostgreSQL-16"
  description = "Managed database engine version. Confirm with `scw rdb engine list` before apply."
}

variable "node_type" {
  type        = string
  default     = "DB-DEV-S"
  description = "Instance commercial type. DB-DEV-S = 2 vCPU / 2 GB, fine for dev. Production wants DB-GP-S or larger."
}

variable "volume_type" {
  type        = string
  default     = "sbs_5k"
  description = "Block storage class. sbs_5k is the current default; bssd is the legacy name and is being retired."
}

variable "volume_size_in_gb" {
  type        = number
  default     = 10
  description = "Volume size in GB. Can be grown later; cannot be shrunk."
}

variable "is_ha_cluster" {
  type        = bool
  default     = false
  description = "Standby node with automatic failover. Roughly doubles cost. Off for dev, on for production."
}

variable "backup_schedule_frequency" {
  type        = number
  default     = 24
  description = "Hours between automatic backups."
}

variable "backup_schedule_retention" {
  type        = number
  default     = 7
  description = "Days to retain automatic backups."
}

# --- Access -----------------------------------------------------------------
variable "allowed_cidrs" {
  type        = list(string)
  default     = []
  description = <<-EOT
    CIDR blocks permitted to reach the database. Deliberately empty by default:
    an apply with no entries creates an instance nothing can connect to, which is
    the safe failure. Add your office/VPN egress IP as a /32, and the runtime's
    egress range. Never 0.0.0.0/0.
  EOT

  validation {
    condition     = !contains(var.allowed_cidrs, "0.0.0.0/0")
    error_message = "0.0.0.0/0 exposes the database to the whole internet. List specific /32s or your VPN range instead."
  }
}

variable "database_name" {
  type        = string
  default     = "bluedoor"
  description = "Application database name."
}

variable "app_user_name" {
  type        = string
  default     = "bluedoor_app"
  description = <<-EOT
    Runtime role the web app connects as. Deliberately NOT the instance admin and
    NOT the table owner: row-level security is bypassed by superusers and, unless
    FORCE is set, by table owners. Migrations run as the admin user; the app never does.
  EOT
}
