"""SQLAlchemy persistence for statements, transactions, and local vendor memory."""
from __future__ import annotations

import json
import os
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from threading import RLock
from typing import Any, Optional

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker


def database_url() -> str:
    configured = os.getenv("DATABASE_URL", "").strip()
    if configured:
        if configured.startswith("postgres://"):
            return "postgresql+psycopg://" + configured[len("postgres://"):]
        if configured.startswith("postgresql://"):
            return "postgresql+psycopg://" + configured[len("postgresql://"):]
        return configured
    return "sqlite:///./finledger.db"


class Base(DeclarativeBase):
    pass


class StatementRow(Base):
    __tablename__ = "statements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    business_id: Mapped[str] = mapped_column(String(200), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(30))
    transaction_count: Mapped[int] = mapped_column(Integer, default=0)
    parser_source: Mapped[str] = mapped_column(String(30))
    warnings_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    transactions: Mapped[list["TransactionRow"]] = relationship(
        back_populates="statement", cascade="all, delete-orphan"
    )


class TransactionRow(Base):
    __tablename__ = "transactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    statement_id: Mapped[str] = mapped_column(ForeignKey("statements.id", ondelete="CASCADE"), index=True)
    business_id: Mapped[str] = mapped_column(String(200), index=True)
    transaction_date: Mapped[date] = mapped_column(Date)
    description: Mapped[str] = mapped_column(Text)
    vendor: Mapped[str] = mapped_column(String(200))
    amount: Mapped[float] = mapped_column(Float)
    category: Mapped[str] = mapped_column(String(100))
    confidence: Mapped[float] = mapped_column(Float)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    memory_used: Mapped[bool] = mapped_column(Boolean, default=False)
    memory_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    subcategory: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    reference: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    balance: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    statement: Mapped[StatementRow] = relationship(back_populates="transactions")


class LocalMemoryRow(Base):
    __tablename__ = "local_vendor_memories"

    business_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    vendor: Mapped[str] = mapped_column(String(200), primary_key=True)
    category: Mapped[str] = mapped_column(String(100))
    retained_at: Mapped[datetime] = mapped_column(DateTime)
    source: Mapped[str] = mapped_column(String(100))
    retained_count: Mapped[int] = mapped_column(Integer, default=1)


class DismissedReviewRow(Base):
    __tablename__ = "dismissed_reviews"

    business_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    transaction_id: Mapped[str] = mapped_column(String(36), primary_key=True)


class WhatsAppReceiptRow(Base):
    __tablename__ = "whatsapp_webhook_receipts"

    provider_message_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    business_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    sender: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="received")
    statement_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    reply_status: Mapped[str] = mapped_column(String(40), nullable=False, default="not_attempted")
    reply_message_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class BusinessRow(Base):
    __tablename__ = "businesses"

    id: Mapped[str] = mapped_column(String(200), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class UserRow(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(20), unique=True, index=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class IntegrationConfigRow(Base):
    __tablename__ = "integration_configs"

    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), primary_key=True)
    provider: Mapped[str] = mapped_column(String(50), primary_key=True)
    encrypted_config: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class BusinessMembershipRow(Base):
    __tablename__ = "business_memberships"
    __table_args__ = (UniqueConstraint("user_id", "business_id", name="uq_business_membership"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(30), nullable=False, default="owner")


class AuthSessionRow(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)


class StatementJobRow(Base):
    __tablename__ = "statement_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    statement_id: Mapped[str] = mapped_column(String(36), ForeignKey("statements.id", ondelete="CASCADE"), unique=True)
    business_id: Mapped[str] = mapped_column(String(200), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(200))
    payload: Mapped[bytes] = mapped_column(LargeBinary)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="queued", index=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    available_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    provider_message_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    sender: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)


class Database:
    def __init__(self, url: Optional[str] = None) -> None:
        self.url = url or database_url()
        if self.url.startswith("postgres://"):
            self.url = "postgresql+psycopg://" + self.url[len("postgres://"):]
        elif self.url.startswith("postgresql://"):
            self.url = "postgresql+psycopg://" + self.url[len("postgresql://"):]
        kwargs: dict[str, Any] = {"future": True, "pool_pre_ping": True}
        if self.url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False}
        self.engine = create_engine(self.url, **kwargs)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False, future=True)
        self.lock = RLock()

    def create_all(self) -> None:
        Base.metadata.create_all(self.engine)

    def session(self):
        return self.sessions()


database = Database()
if os.getenv("AUTO_CREATE_DB", "true").lower() == "true":
    database.create_all()


def statement_dict(row: StatementRow) -> dict[str, Any]:
    return {
        "id": row.id,
        "business_id": row.business_id,
        "filename": row.filename,
        "status": row.status,
        "transaction_count": row.transaction_count,
        "parser_source": row.parser_source,
        "warnings": json.loads(row.warnings_json or "[]"),
        "created_at": row.created_at,
    }


def transaction_dict(row: TransactionRow) -> dict[str, Any]:
    return {
        "id": row.id,
        "statement_id": row.statement_id,
        "business_id": row.business_id,
        "date": row.transaction_date,
        "description": row.description,
        "vendor": row.vendor,
        "amount": row.amount,
        "category": row.category,
        "confidence": row.confidence,
        "confirmed": row.confirmed,
        "memory_used": row.memory_used,
        "memory_summary": row.memory_summary,
        "subcategory": row.subcategory,
        "reference": row.reference,
        "balance": row.balance,
        "currency": row.currency,
    }


def make_statement(data: Any) -> StatementRow:
    return StatementRow(
        id=data.id,
        business_id=data.business_id,
        filename=data.filename,
        status=data.status,
        transaction_count=data.transaction_count,
        parser_source=data.parser_source,
        warnings_json=json.dumps(data.warnings),
        created_at=data.created_at,
    )


def make_transaction(data: Any) -> TransactionRow:
    return TransactionRow(
        id=data.id,
        statement_id=data.statement_id,
        business_id=data.business_id,
        transaction_date=data.date,
        description=data.description,
        vendor=data.vendor,
        amount=float(data.amount),
        category=data.category,
        confidence=data.confidence,
        confirmed=data.confirmed,
        memory_used=data.memory_used,
        memory_summary=data.memory_summary,
        subcategory=data.subcategory,
        reference=data.reference,
        balance=data.balance,
        currency=data.currency,
    )
