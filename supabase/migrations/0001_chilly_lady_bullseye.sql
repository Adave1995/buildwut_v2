CREATE TABLE "hidden_entity" (
	"user_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hidden_entity_user_id_entity_id_pk" PRIMARY KEY("user_id","entity_id")
);
--> statement-breakpoint
ALTER TABLE "hidden_entity" ADD CONSTRAINT "hidden_entity_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_item_user_entity_unique" ON "pipeline_item" USING btree ("user_id","entity_id");