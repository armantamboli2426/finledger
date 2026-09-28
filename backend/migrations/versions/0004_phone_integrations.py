"""Add account phone numbers and encrypted per-business provider settings."""

import sqlalchemy as sa
from alembic import op

revision = "0004_phone_integrations"
down_revision = "0003_auth_and_durable_jobs"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("phone", sa.String(length=20), nullable=True))
    op.create_index("ix_users_phone", "users", ["phone"], unique=True)
    op.create_table(
        "integration_configs",
        sa.Column(
            "business_id",
            sa.String(length=200),
            sa.ForeignKey("businesses.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("provider", sa.String(length=50), primary_key=True),
        sa.Column("encrypted_config", sa.LargeBinary(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )


def downgrade():
    op.drop_table("integration_configs")
    op.drop_index("ix_users_phone", table_name="users")
    op.drop_column("users", "phone")
