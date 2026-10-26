-- Erweiterungen: PostGIS für Umkreissuche, pg_trgm für unscharfe Ortssuche
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Vertical" AS ENUM ('MARKETPLACE', 'VEHICLES', 'REAL_ESTATE', 'JOBS');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('PRIVATE', 'BUSINESS');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('FIXED', 'NEGOTIABLE', 'FREE', 'ON_REQUEST');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'EXPIRED', 'REJECTED', 'DELETED');

-- CreateEnum
CREATE TYPE "ItemCondition" AS ENUM ('NEW', 'LIKE_NEW', 'GOOD', 'ACCEPTABLE', 'DEFECTIVE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "account_type" "AccountType" NOT NULL DEFAULT 'PRIVATE',
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "avatar_url" TEXT,
    "bio" TEXT,
    "phone" TEXT,
    "company_name" TEXT,
    "company_register_number" TEXT,
    "vat_id" TEXT,
    "company_address" TEXT,
    "terms_accepted_at" TIMESTAMP(3),
    "terms_version" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "states" (
    "id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "districts" (
    "id" INTEGER NOT NULL,
    "state_id" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" SERIAL NOT NULL,
    "postal_code" VARCHAR(4) NOT NULL,
    "place" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "district_id" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "geom" geography(Point, 4326),

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "parent_id" TEXT,
    "vertical" "Vertical" NOT NULL,
    "slug" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "attribute_schema" JSONB,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "seller_id" UUID NOT NULL,
    "category_id" TEXT,
    "vertical" "Vertical" NOT NULL DEFAULT 'MARKETPLACE',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price_type" "PriceType",
    "price_cents" BIGINT,
    "condition" "ItemCondition",
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "location_id" INTEGER,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_images" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "ip_prefix" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "states_code_key" ON "states"("code");

-- CreateIndex
CREATE UNIQUE INDEX "states_slug_key" ON "states"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "districts_state_id_slug_key" ON "districts"("state_id", "slug");

-- CreateIndex
CREATE INDEX "locations_postal_code_idx" ON "locations"("postal_code");

-- CreateIndex
CREATE INDEX "locations_district_id_idx" ON "locations"("district_id");

-- CreateIndex
CREATE INDEX "locations_geom_idx" ON "locations" USING GIST ("geom");

-- CreateIndex
CREATE UNIQUE INDEX "locations_postal_code_place_key" ON "locations"("postal_code", "place");

-- CreateIndex
CREATE UNIQUE INDEX "categories_path_key" ON "categories"("path");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE INDEX "categories_vertical_is_active_idx" ON "categories"("vertical", "is_active");

-- CreateIndex
CREATE INDEX "listings_status_published_at_idx" ON "listings"("status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "listings_seller_id_status_idx" ON "listings"("seller_id", "status");

-- CreateIndex
CREATE INDEX "listings_category_id_status_idx" ON "listings"("category_id", "status");

-- CreateIndex
CREATE INDEX "listings_location_id_idx" ON "listings"("location_id");

-- CreateIndex
CREATE INDEX "listings_expires_at_idx" ON "listings"("expires_at");

-- CreateIndex
CREATE INDEX "listing_images_listing_id_sort_order_idx" ON "listing_images"("listing_id", "sort_order");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- AddForeignKey
ALTER TABLE "districts" ADD CONSTRAINT "districts_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

