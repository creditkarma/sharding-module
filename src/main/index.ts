import { ShardManager } from './ShardManager'
import {
    ILogger,
    ISettingsObj,
    IShardManager,
} from './types'

export * from './types'

export default <Client>(
    config: ISettingsObj<Client>,
    logger: ILogger,
): IShardManager<Client> => {
    return new ShardManager(config, logger)
}
