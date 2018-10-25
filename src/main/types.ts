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

export type ShardOperation1<Result> = (shard: number) => Promise<Result>

export type ShardOperation2<Result, arg> = (
    shard: number,
    opts: arg,
) => Promise<Result>

export type ShardOperation<Result, ArgType> =
    | ShardOperation1<Result>
    | ShardOperation2<Result, ArgType>

export interface IShardManager<Client> {
    getShard(shardid: number | string): number
    pickRandomShard(): number
    getClient(num: number, schema: string): Client
    updateClient(
        num: number,
        schema: string,
        newShardSettings: Partial<IShardInstance>,
    ): void
    getNumShards(): number
    doForAllShards<Result, ArgType>(
        op: ShardOperation<Result, ArgType>,
        args?: ArgType,
    ): Promise<Array<Result>>
}
