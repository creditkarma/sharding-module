import {
    HashFunction,
    ILogger,
    ISettingsObj,
    IShardInstance,
    IShardManager,
    ShardOperation,
} from './types'

export class ShardManager<Client> implements IShardManager<Client> {
    private settings: ISettingsObj<Client>
    private numShards: number = 0
    private shards: { [index: string]: Client }
    private logger: ILogger
    private hashFunction: HashFunction

    constructor(config: ISettingsObj<Client>, logger: ILogger) {
        this.settings = config
        this.shards = {}
        this.logger = logger
        this.hashFunction = config.hashFunction
        this.init()
    }

    public getShard(shardid: number | string): number {
        if (typeof shardid === 'string') {
            const hash: number = this.hashFunction(shardid, this.numShards)
            return hash % this.numShards
        } else if (Number.isInteger(shardid)) {
            return Math.abs(shardid % this.numShards)
        } else {
            throw new Error('shardid must be a string or integer')
        }
    }

    public pickRandomShard(): number {
        return Math.floor(Math.random() * this.numShards)
    }

    public getNumShards(): number {
        return this.numShards
    }

    public getClient(num: number, schema: string): Client {
        const shardName = this.getShardName(num, schema)
        if (this.shards[shardName]) {
            return this.shards[shardName]
        } else {
            this.logger.error(`shard map: ${Object.keys(this.shards).sort()}`)
            this.logger.error(`message=Shard not found, shard=${shardName}`)
            throw new Error(`${shardName} not found`)
        }
    }

    public updateClient(num: number, schema: string): Client {
        const shardName = this.getShardName(num, schema)
        const shardIndex = this.getShard(num)
        const shardSettings = this.findSettingsForShard(shardIndex)
        this.shards[shardName] = this.settings.createClient(
            shardName,
            shardSettings,
        )
        return this.shards[shardName]
    }

    public doForAllShards<Result>(
        op: ShardOperation<Result>,
        args: any,
    ): Promise<Array<Result>> {
        const requests: Array<Promise<Result>> = []
        for (let i = 0; i < this.numShards; i++) {
            const q = op(i, args)
            requests.push(q)
        }
        return Promise.all(requests)
    }

    public findSettingsForShard(num: number): IShardInstance {
        const shardList = this.settings.sharding['shard-map']
        const shard = shardList.find(s => {
            return s['virtual-start'] <= num && s['virtual-end'] >= num
        })
        if (!shard) {
            throw new Error(`no shard found for ${num}`)
        }
        return shard
    }

    private init() {
        const settings = this.settings

        this.numShards = settings.sharding['shard-count']

        // on startup, create clients
        for (let shardIndex = 0; shardIndex < this.numShards; shardIndex++) {
            let prefixes = settings.sharding.prefix
            const shardSettings = this.findSettingsForShard(shardIndex)

            if (!Array.isArray(prefixes)) {
                prefixes = [prefixes]
            }
            prefixes
                .map((prefix: string) => this.getShardName(shardIndex, prefix))
                .forEach((databaseName: string) => {
                    this.shards[databaseName] = this.settings.createClient(
                        databaseName,
                        shardSettings,
                    )
                })
        }
    }

    private getShardName(num: number, schema: string): string {
        if (num < 0) {
            throw new Error(`negative shard index (${num}) is invalid`)
        } else if (!Number.isInteger(num)) {
            throw new Error(`non-integer shard index (${num}) is invalid`)
        } else {
            // Left pad the number to make sure it's 4 digits
            let numStr = `${num}`
            while (numStr.length < 4) {
                numStr = `0${numStr}`
            }
            return `${schema}_${numStr}`
        }
    }
}
