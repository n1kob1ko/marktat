import { Global, Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module.js';
import { GeoModule } from '../geo/geo.module.js';
import { ImagesModule } from '../images/images.module.js';
import { ListingSearchService } from './listing-search.service.js';
import { SearchIndexService } from './search-index.service.js';

/** Global, damit Inserate, Bilder und Profile den Index aktualisieren können, ohne Modul-Zyklen. */
@Global()
@Module({
  imports: [CategoriesModule, GeoModule, ImagesModule],
  providers: [SearchIndexService, ListingSearchService],
  exports: [SearchIndexService, ListingSearchService],
})
export class SearchModule {}
