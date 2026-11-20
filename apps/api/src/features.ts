import { JobsModule } from './jobs/jobs.service';
import { MaintenanceModule } from './jobs/maintenance.service';
import { SettingsModule } from './settings/settings.service';
import { CmsModule } from './cms/cms.controller';
import { PublicModule } from './public/public.controller';
import { ProvidersModule } from './providers/providers.controller';

/** Feature modules, added phase by phase. */
export const FEATURE_MODULES: any[] = [JobsModule, MaintenanceModule, SettingsModule, CmsModule, PublicModule, ProvidersModule];
