import { JobsModule } from './jobs/jobs.service';
import { MaintenanceModule } from './jobs/maintenance.service';
import { SettingsModule } from './settings/settings.service';
import { CmsModule } from './cms/cms.controller';
import { PublicModule } from './public/public.controller';
import { ProvidersModule } from './providers/providers.controller';
import { ActivitiesModule } from './activities/activities.controller';
import { ClaimsModule } from './claims/claims.controller';

/** Feature modules, added phase by phase. */
export const FEATURE_MODULES: any[] = [JobsModule, MaintenanceModule, SettingsModule, CmsModule, PublicModule, ProvidersModule, ActivitiesModule, ClaimsModule];
