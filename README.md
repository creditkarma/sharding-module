# Shard Manager

`shard manager` is used to manage shards in Node.js. We can provide our own sharding schema to shard the keys.

## Installation

``` bash
npm install @creditkarma/sharding-module
```

## Setting up the module

We have `createShardManager` exposed that can be used to instantiate a sharding module. We should pass in the sharding config we choose, any custom hashing function to shard the keys, a function to create the client connection for every shard and finally a logger function to be used for logging.

```typescript
import { createShardManager, ISettingsObj, IShardInstance, IShardManager, IShardObj } from '@creditkarma/sharding-module'
const prefixList: Array<string> = [ 'prefix1', 'prefix2' ]
const shardMap: Array<IShardInstance> = [
    {
        'virtual-start': 0,
        'virtual-end': 1,
        'host': <hostIP1>,
        'port': 3306,
        'user': <mysql_user>,
        'password': <mysql_password>
    },
    {
        'virtual-start': 2,
        'virtual-end': 3,
        'host': <hostIP2>,
        'port': 3306,
        'user': <mysql_user2>,
        'password': <mysql_password2>
    },
]
const sharding: IShardObj = {
    'prefix': prefixList,
    'shard-count': 4,
    'shard-map': shardMap
}

function someHashFunction(a: string, b: number): number {
    return hash
}

function someDBCreateFunction(dbName: string, dbSettings: IShardInstance): Client {
    return client
}

const loggerFn = console

const sConfig: ISettingsObj<mysql.Pool> = {
    sharding: sharding, // Sharding configuration
    hashFunction: someHashFunction, // Hash function to shard keys
    createClient: someDBCreateFunction, // Function to create new connection per shard
}
const shardMgr: IShardManager = createShardManager(sConfig, loggerFn)

```

## API

### Public methods

**getShard**: Get the shard ID for a particular key.

* `key`: **String / Number**, the key to be sharded

```typescript
const shardId: Number = shardMgr.getShard(key).catch((err) => {return err});
```

This API throws an error if the key is not either a string or number.


**pickRandomShard**: Get a random shard from the available shards

```typescript
const randomShardId: Number = shardMgr.pickRandomShard()
```


**getNumShards**: Gets the number of shards being deployed

```typescript
const noShards: Number = shardMgr.getNumShards()
```


**getClient**: Gets the client connection for a particular shard and prefix

* `shardId`: **number**, shard of the client
* `prefix`: **string**, prefix of the client

```typescript
const client = shardMgr.getClient(shardId. prefix)
```


**updateClient**: Re-establish the database client connection. Useful to recover from any dynamic changes in the env

* `shardId`: **number**, shardId of the database
* `prefix`: **string**, prefix
* `newShardSettings`: **Partial<IShardInstance>**, updated shard settings

```typescript
const newShardSettings: Partial<IShardInstance> = {
    'host': <updatedIP>,
    'port': <updatedPort>
}
const client = shardMgr.updateClient(shardId, prefix, newShardSettings)
```


**doForAllShards**: Loops over all the shards and runs the given function for each of them

* `op`: **function**,
* `opts`: **argType (optional)**,

```typescript
function op(shardId, opts): <Result> { }
const opts = {}

const results: Array<Result> = shardMgr.doForAllShards(op)
OR
const results: Array<Result> = shardMgr.doForAllShards(op, opts)
```


## License

This project is licensed under [Apache License Version 2.0](./LICENSE)
