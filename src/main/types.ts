export interface ILogger {
    log: (input: any) => void
    error: (input: any) => void
    warn: (input: any) => void
    debug: (input: any) => void
}

export interface IShardInstance {
    'virtual-start': number
    'virtual-end': number
    host: string
    port: number
    user: string
    password: string
}

export interface IShardObj {
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

export type ClientCreator<Client> = (
    databaseName: string,
    settingsForShard: IShardInstance,
) => Client

export type HashFunction = (s: string, n: number) => number

export type ShardOperation<Result> = (
    shard: number,
    opts: any,
) => Promise<Result>

export interface IShardManager<Client> {
    getShard(shardid: number | string): number
    pickRandomShard(): number
    getClient(num: number, schema: string): Client
    updateClient(num: number, schema: string): Client
    getNumShards(): number
    doForAllShards<Result>(
        op: ShardOperation<Result>,
        args: any,
    ): Promise<Array<Result>>
    findSettingsForShard(num: number): IShardInstance
}
