"""Create initial FINLEDGER persistence schema."""

import sqlalchemy as sa
from alembic import op

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "statements",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("business_id", sa.String(length=200), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("transaction_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("parser_source", sa.String(length=30), nullable=False),
        sa.Column("warnings_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
    )
    op.create_index("ix_statements_business_id", "statements", ["business_id"])
    op.create_table(
        "transactions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("statement_id", sa.String(length=36), sa.ForeignKey("statements.id", ondelete="CASCADE"), nullable=False),
        sa.Column("business_id", sa.String(length=200), nullable=False),
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("vendor", sa.String(length=200), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("confirmed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("memory_used", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("memory_summary", sa.Text(), nullable=True),
        sa.Column("subcategory", sa.String(length=100), nullable=True),
        sa.Column("reference", sa.String(length=200), nullable=True),
        sa.Column("balance", sa.Float(), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="INR"),
    )
    op.create_index("ix_transactions_statement_id", "transactions", ["statement_id"])
    op.create_index("ix_transactions_business_id", "transactions", ["business_id"])
    op.create_table(
        "local_vendor_memories",
        sa.Column("business_id", sa.String(length=200), primary_key=True),
        sa.Column("vendor", sa.String(length=200), primary_key=True),
        sa.Column("category", sa.String(length=100), nullable=False),
        sa.Column("retained_at", sa.DateTime(), nullable=False),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("retained_count", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_table(
        "dismissed_reviews",
        sa.Column("business_id", sa.String(length=200), primary_key=True),
        sa.Column("transaction_id", sa.String(length=36), primary_key=True),
    )


def downgrade():
    op.drop_table("dismissed_reviews")
    op.drop_table("local_vendor_memories")
    op.drop_index("ix_transactions_business_id", table_name="transactions")
    op.drop_index("ix_transactions_statement_id", table_name="transactions")
    op.drop_table("transactions")
    op.drop_index("ix_statements_business_id", table_name="statements")
    op.drop_table("statements")
