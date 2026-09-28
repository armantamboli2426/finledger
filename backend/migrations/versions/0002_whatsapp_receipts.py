"""Persist WhatsApp webhook receipts and deduplication state."""

import sqlalchemy as sa
from alembic import op

revision = "0002_whatsapp_receipts"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "whatsapp_webhook_receipts",
        sa.Column("provider_message_id", sa.String(length=200), primary_key=True),
        sa.Column("business_id", sa.String(length=200), nullable=False),
        sa.Column("sender", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="received"),
        sa.Column("statement_id", sa.String(length=36), nullable=True),
        sa.Column("reply_status", sa.String(length=40), nullable=False, server_default="not_attempted"),
        sa.Column("reply_message_id", sa.String(length=200), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_whatsapp_webhook_receipts_business_id",
        "whatsapp_webhook_receipts",
        ["business_id"],
    )


def downgrade():
    op.drop_index("ix_whatsapp_webhook_receipts_business_id", table_name="whatsapp_webhook_receipts")
    op.drop_table("whatsapp_webhook_receipts")
