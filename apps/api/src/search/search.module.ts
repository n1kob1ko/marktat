import { Global, Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module.js';
import { GeoModule } from '../geo/geo.module.js';
import { ImagesModule } from '../images/images.module.js';
import { DealSearchService } from '../deals/deal-search.service.js';
import { ListingSearchService } from './listing-search.service.js';
import { SearchIndexService } from './search-index.service.js';

/** Global, damit Inserate, Bilder, Profile, Deals und Moderation die Indizes aktualisieren können, ohne Modul-Zyklen. */
@Global()
@Module({
  imports: [CategoriesModule, GeoModule, ImagesModule],
  providers: [SearchIndexService, ListingSearchService, DealSearchService],
  exports: [SearchIndexService, ListingSearchService, DealSearchService],
})
export class SearchModule {}
