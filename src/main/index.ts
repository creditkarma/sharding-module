export interface IShardInstance {
    'virtual-start': number
    'virtual-end': number
    host: string
    port: number
}

interface IShardObj {
    prefix: Array<string>
    'shard-count': number
    'shard-map': Array<IShardInstance>
}

export interface ISettingsObj<Client> {
    logLevel?: string
    sharding: IShardObj
    createClient: ClientCreator<Client>
    hashFunction: HashFunction
}

type ClientCreator<Client> = (
    databaseName: string,
    settingsForShard: IShardInstance,
) => Client

type HashFunction = (s: string, n: number) => number

class NewShardMgr<Client> {
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
    public doForAllShards<Result>(f: (shard: number) => Promise<Result>): Promise<Array<Result>> {
        const requests: Array<Promise<Result>> = []
        for (let i = 0; i < this.numShards; i++) {
            const q = f(i)
            requests.push(q)
        }
        return Promise.all(requests)
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
                    this.shards[databaseName] = this.settings.createClient(databaseName, shardSettings)
                })
        }
    }
    private findSettingsForShard(num: number): IShardInstance {
        const shardList = this.settings.sharding['shard-map']
        const shard = shardList.find((s) => {
            return s['virtual-start'] <= num && s['virtual-end'] >= num
        })
        if (!shard) {
            throw new Error(`no shard found for ${num}`)
        }
        return shard
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

export default <Client>(
    config: ISettingsObj<Client>,
    logger: ILogger,
): NewShardMgr<Client> => {
    return new NewShardMgr(config, logger)
}
