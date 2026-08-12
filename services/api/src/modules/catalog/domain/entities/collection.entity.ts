import {
  asCollectionId,
  type CatalogStatus,
  type CollectionId,
  type CollectionRules,
  type CollectionType,
  type LocalizedText,
  type SeoMetadata,
} from '@iecp/types';

/** blueprint §7 merchandising — manual or dynamic (rules-evaluated)
 * membership. See ADR-005 decision 4 / CollectionRuleEvaluator. */
export class Collection {
  private constructor(
    public readonly id: CollectionId,
    public readonly name: string,
    public readonly slug: string,
    public readonly localizedName: LocalizedText | null,
    public readonly description: string | null,
    public readonly type: CollectionType,
    public readonly rules: CollectionRules | null,
    public readonly priority: number,
    public readonly startAt: Date | null,
    public readonly endAt: Date | null,
    public readonly status: CatalogStatus,
    public readonly publishedAt: Date | null,
    public readonly imageMediaId: string | null,
    public readonly seo: SeoMetadata | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly deletedAt: Date | null,
  ) {}

  static create(props: {
    id: string;
    name: string;
    slug: string;
    localizedName?: LocalizedText | null;
    description?: string | null;
    type?: CollectionType;
    rules?: CollectionRules | null;
    priority?: number;
    startAt?: Date | null;
    endAt?: Date | null;
    status?: CatalogStatus;
    publishedAt?: Date | null;
    imageMediaId?: string | null;
    seo?: SeoMetadata | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
  }): Collection {
    return new Collection(
      asCollectionId(props.id),
      props.name,
      props.slug,
      props.localizedName ?? null,
      props.description ?? null,
      props.type ?? 'MANUAL',
      props.rules ?? null,
      props.priority ?? 0,
      props.startAt ?? null,
      props.endAt ?? null,
      props.status ?? 'ACTIVE',
      props.publishedAt ?? null,
      props.imageMediaId ?? null,
      props.seo ?? null,
      props.createdAt,
      props.updatedAt,
      props.deletedAt ?? null,
    );
  }

  /** Whether the collection is currently within its display window (if it has one). */
  isWithinWindow(now: Date): boolean {
    if (this.startAt && now < this.startAt) return false;
    if (this.endAt && now > this.endAt) return false;
    return true;
  }
}
