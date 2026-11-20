import { SettingsModule } from './settings/settings.service';
import { CmsModule } from './cms/cms.controller';
import { PublicModule } from './public/public.controller';

/** Feature modules, added phase by phase. */
export const FEATURE_MODULES: any[] = [SettingsModule, CmsModule, PublicModule];
