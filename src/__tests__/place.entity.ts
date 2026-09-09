import { Column, ColumnOptions, Entity, PrimaryGeneratedColumn } from 'typeorm'

/**
 * A geographic point column. On PostgreSQL it is a real PostGIS `geometry(Point, 4326)` column
 * (exercising the `point`/`ST_Distance` distance strategy); on other engines PostGIS types don't
 * exist, so it degrades to a nullable JSON column that the non-PostGIS tests simply leave unset.
 */
const PointColumnOptions: ColumnOptions =
    process.env.DB === 'postgres'
        ? { type: 'geometry', spatialFeatureType: 'Point', srid: 4326, nullable: true }
        : { type: 'simple-json', nullable: true }

@Entity({ name: 'place' })
export class PlaceEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    name: string

    // Plain numeric lat/lng drive the portable Haversine and custom-expression strategies on every DB.
    @Column({ type: 'float', nullable: true })
    lat: number | null

    @Column({ type: 'float', nullable: true })
    lng: number | null

    // GeoJSON `{ type: 'Point', coordinates: [lng, lat] }` on PostgreSQL; unset elsewhere.
    @Column(PointColumnOptions)
    location?: { type: 'Point'; coordinates: [number, number] } | null
}
