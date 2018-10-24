import {
    HashFunction,
    ILogger,
    ISettingsObj,
    IShardInstance,
    IShardManager,
    ShardOperation1,
    ShardOperation2,
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
            this.logger.error(`shard ${shardid} invalid`)
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

    public updateClient(num: number, schema: string): void {
        const shardIndex = this.getShard(num)
        const shardSettings = this.findSettingsForShard(shardIndex)
        let start = shardSettings['virtual-start']
        const end = shardSettings['virtual-end']
        while(start <= end) {
            const shardName = this.getShardName(start, schema)
            this.shards[shardName] = this.settings.createClient(shardName, shardSettings);
            start++
        }
    }

    public doForAllShards<Result>(
        op: ShardOperation1<Result>,
    ): Promise<Array<Result>>
    public doForAllShards<Result, argType>(
        op: ShardOperation2<Result, argType>,
        args: argType,
    ): Promise<Array<Result>>
    public doForAllShards(...args: Array<any>): Promise<Array<any>> {
        const op = args[0]
        const arg = args[1]
        const requests: Array<Promise<any>> = []
        for (let i = 0; i < this.numShards; i++) {
            const q = arg !== undefined ? op(i, arg) : op(i)
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
            this.logger.error(`Missing shard ${num}`)
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
            this.logger.error(`Negative shard requested ${num}!!!`)
            throw new Error(`negative shard index (${num}) is invalid`)
        } else if (!Number.isInteger(num)) {
            this.logger.error(`Invalid shard requested ${num}`)
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
