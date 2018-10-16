import { expect, fail } from 'code'
import * as Lab from 'lab'
import * as mysql from 'mysql'
import * as murmurhash from 'node-murmurhash'
import { createShardManager as shardMgr } from '../../main/index'
import { arbitraryInteger } from '../helpers/generators'
import { query } from '../helpers/mysql'
import { retry } from '../helpers/promises'

export const lab = Lab.script()
const { beforeEach, afterEach, describe, it } = lab

function getDbConnection(): mysql.Connection {
    return mysql.createConnection({
        user: 'root',
        password: 'root',
        host: 'localhost',
        port: 3306,
    })
}

describe('Integration Tests', { timeout: 30000 }, () => {
    it('should be able to talk to the database', async () => {
        const result = await retry(() =>
            query(getDbConnection(), 'SELECT "hello world" AS foo'),
        )
        expect(result).to.equal([{ foo: 'hello world' }])
    })
})

describe('Shard Manager', { timeout: 30000 }, () => {
    const sm = shardMgr(
        {
            sharding: {
                prefix: ['example_todoId'],
                'shard-count': 4,
                'shard-map': [
                    {
                        'virtual-start': 0,
                        'virtual-end': 3,
                        host: 'localhost',
                        port: 3306,
                        user: 'root',
                        password: 'root',
                    },
                ],
            },
            hashFunction: murmurhash,
            createClient(databaseName, shardSettings) {
                return mysql.createPool({
                    user: shardSettings.user,
                    password: shardSettings.password,
                    database: databaseName,
                    host: shardSettings.host,
                    port: shardSettings.port,
                })
            },
        },
        console,
    )

    // Use a clean slate for each test.
    beforeEach(() => {
        return Promise.all([
            // The DB server used for integration tests takes some time to
            // start up. Since these CREATE DATABASE operations are the first
            // DB interactions performed by this test suite, slap a retry
            // policy on them to tolerate the slow startup.
            retry(() =>
                query(
                    getDbConnection(),
                    'CREATE DATABASE IF NOT EXISTS example_todoId_0000',
                ),
            ),
            retry(() =>
                query(
                    getDbConnection(),
                    'CREATE DATABASE IF NOT EXISTS example_todoId_0001',
                ),
            ),
            retry(() =>
                query(
                    getDbConnection(),
                    'CREATE DATABASE IF NOT EXISTS example_todoId_0002',
                ),
            ),
            retry(() =>
                query(
                    getDbConnection(),
                    'CREATE DATABASE IF NOT EXISTS example_todoId_0003',
                ),
            ),
        ]).then(() =>
            sm.doForAllShards(shardIndex => {
                const client = sm.getClient(shardIndex, 'example_todoId')
                return query(client, 'DROP TABLE IF EXISTS todos').then(_ =>
                    query(
                        client,
                        `CREATE TABLE todos (
                            todoId int unsigned NOT NULL,
                            name varchar(40) NOT NULL,
                            completedAt datetime DEFAULT NULL,
                            deletedAt datetime DEFAULT NULL,
                            PRIMARY KEY (todoId)
                        )`,
                    ),
                )
            }, {}),
        )
    })
    afterEach(() => {
        return Promise.all([
            query(getDbConnection(), 'DROP DATABASE example_todoId_0000'),
            query(getDbConnection(), 'DROP DATABASE example_todoId_0001'),
            query(getDbConnection(), 'DROP DATABASE example_todoId_0002'),
            query(getDbConnection(), 'DROP DATABASE example_todoId_0003'),
        ])
    })

    it('should be able to insert a row, then select it', async () => {
        const todo = { todoId: arbitraryInteger(), name: 'buy milk' }
        const shard = sm.getShard(todo.todoId)
        const client = sm.getClient(shard, 'example_todoId')
        const results = await query(
            client,
            'INSERT INTO todos SET ?',
            todo,
        ).then(_ =>
            query(client, 'SELECT * FROM todos WHERE todoId = ?', [
                todo.todoId,
            ]),
        )

        expect(results).to.equal([
            {
                completedAt: null,
                deletedAt: null,
                ...todo,
            },
        ])
    })

    it('should be able to insert many rows, then select them all', async () => {
        const todos = [
            { todoId: arbitraryInteger(), name: 'buy milk' },
            { todoId: arbitraryInteger(), name: 'pick up dry cleaning' },
            { todoId: arbitraryInteger(), name: 'call mom' },
            { todoId: arbitraryInteger(), name: 'take out the trash' },
            { todoId: arbitraryInteger(), name: 'order pizza for dinner' },
            { todoId: arbitraryInteger(), name: 'take over the world' },
        ]
        const resultSets = await Promise.all(
            todos.map(todo => {
                const todoShardIndex = sm.getShard(todo.todoId)
                const todoClient = sm.getClient(
                    todoShardIndex,
                    'example_todoId',
                )
                return query(todoClient, 'INSERT INTO todos SET ?', todo)
            }),
        ).then(() => {
            return sm.doForAllShards(shardIndex => {
                const client = sm.getClient(shardIndex, 'example_todoId')
                return query(client, 'SELECT * FROM todos')
            }, {})
        })

        // There should be a result set for each shard.
        expect(resultSets).length(4)

        const results: Array<any> = resultSets.reduce((flattened, element) => {
            return flattened.concat(element, [])
        })

        expect(results).length(todos.length)
        todos.forEach(todo => {
            const relevantResult = results.find(result => {
                return result.todoId === todo.todoId
            })
            expect(relevantResult).to.equal({
                completedAt: null,
                deletedAt: null,
                ...todo,
            })
        })
    })

    it('should propagate database errors', async () => {
        const shard = sm.getShard(42)
        const client = sm.getClient(shard, 'example_todoId')

        await query(client, 'this is not a valid SQL string')
            .then(_ => fail('execution should not reach here'))
            .catch(err => expect(err).to.error(Error, /\bER_PARSE_ERROR\b/))
    })
})
