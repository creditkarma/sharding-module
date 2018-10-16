import { expect } from 'code'
import * as Lab from 'lab'
import * as mysql from 'mysql'
import * as murmurhash from 'node-murmurhash'
import {
    createShardManager as shardMgr,
    ISettingsObj,
    IShardInstance,
} from '../../main/index'
import { arbitraryInteger } from '../helpers/generators'

export const lab = Lab.script()
const { describe, it } = lab

// The definitions for PoolConfig from @types/mysql 2.15.5 are not valid for
// mysql 2.15.0. The connection configs live in their own property. See
// <https://github.com/mysqljs/mysql/blob/v2.15.0/lib/PoolConfig.js#L13>.
// TODO: Upstream this fix!
export interface IFixedPoolConfig {
    acquireTimeout?: number
    waitForConnections?: boolean
    connectionLimit?: number
    queueLimit?: number
    connectionConfig: mysql.ConnectionConfig
}

describe('Shard Manager', () => {
    const testSchemaName = 'tests'
    const config: ISettingsObj<mysql.Pool> = {
        logLevel: 'debug',
        sharding: {
            prefix: [testSchemaName],
            'shard-count': 4,
            'shard-map': [
                {
                    'virtual-start': 0,
                    'virtual-end': 2,
                    host: 'localhost',
                    port: 3306,
                    user: 'testuser',
                    password: 'testpassword',
                },
                {
                    'virtual-start': 3,
                    'virtual-end': 3,
                    host: 'not-localhost.com',
                    port: 1337,
                    user: 'testuser',
                    password: 'testpassword',
                },
            ],
        },
        createClient: (databaseName: string, shardSettings: IShardInstance) => {
            return mysql.createPool({
                user: shardSettings.user,
                password: shardSettings.password,
                database: databaseName,
                host: shardSettings.host,
                port: shardSettings.port,
            })
        },
        hashFunction: murmurhash,
    }
    const sm = shardMgr(config, console)

    function randomShardIndex(): number {
        return arbitraryInteger(config.sharding['shard-count'])
    }

    describe('getShard', () => {
        it('should return the expected shard for string keys', async () => {
            const testCases: Array<[string, number]> = [
                ['this key should hit shard 0', 0],
                ['this key should hit shard 1!', 1],
                ['this key should hit shard 2!', 2],
                ['this key should hit shard 3', 3],
                ['', 3],
            ]
            testCases.forEach(([key, expectedShardIndex]) => {
                const shardIndex = sm.getShard(key)
                expect(shardIndex).to.equal(expectedShardIndex)
            })
        })

        it('should return the expected shard for numeric keys', async () => {
            const testCases: Array<[number, number]> = [
                [0, 0],
                [1, 1],
                [2, 2],
                [3, 3],
                [5, 1],
                [1023, 3],
                [-42, 2],
                [-0, 0],
            ]
            testCases.forEach(([key, expectedShardIndex]) => {
                const shardIndex = sm.getShard(key)
                expect(shardIndex).to.equal(expectedShardIndex)
            })

            it('should throw on invalid keys', async () => {
                const invalidKeys = [
                    0.1,
                    Number.EPSILON,
                    Math.PI,
                    NaN,
                    Infinity,
                    -Infinity,
                ]
                invalidKeys.forEach(invalidKey => {
                    expect(() => sm.getShard(invalidKey)).to.throw()
                })
            })
        })
    })

    describe('getClient', () => {
        it('should get the correct client', async () => {
            const testCases: Array<[number, {}]> = [
                [0, { host: 'localhost', port: 3306, database: 'tests_0000' }],
                [1, { host: 'localhost', port: 3306, database: 'tests_0001' }],
                [2, { host: 'localhost', port: 3306, database: 'tests_0002' }],
                [
                    3,
                    {
                        host: 'not-localhost.com',
                        port: 1337,
                        database: 'tests_0003',
                    },
                ],
            ]
            testCases.forEach(([num, expectedPoolConfig]) => {
                const connectionConfig = (sm.getClient(num, testSchemaName)
                    .config as IFixedPoolConfig).connectionConfig
                expect(connectionConfig).to.include(expectedPoolConfig)
            })
        })

        it('should throw on missing schemas', async () => {
            const missingSchemas = [
                'notAConfiguredSchemaName',
                `${testSchemaName}_0000`, // This is a shard name, not a schema name.
                '',
            ]
            missingSchemas.forEach(missingSchema => {
                expect(() =>
                    sm.getClient(randomShardIndex(), missingSchema),
                ).to.throw()
            })
        })

        it('should throw on invalid shard indexes', async () => {
            const invalidShardIndexes = [4, 1.5, Infinity, NaN, -1, -8675309]
            invalidShardIndexes.forEach(invalidShardIndex => {
                expect(() =>
                    sm.getClient(invalidShardIndex, testSchemaName),
                ).to.throw()
            })
        })
    })

    describe('doForAllShards', () => {
        it('should apply the given function to every shard', async () => {
            function successfulResponse(shardIndex: number): string {
                return `response for shard index ${shardIndex}`
            }
            const responses = await sm.doForAllShards(shardIndex => {
                return Promise.resolve(successfulResponse(shardIndex))
            }, {})
            expect(responses).length(4)
            expect(responses).to.include([
                successfulResponse(0),
                successfulResponse(1),
                successfulResponse(2),
                successfulResponse(3),
            ])
        })

        it('should propagate errors', async () => {
            function errorMessage(shardIndex: number): string {
                return `the operation on shard index ${shardIndex} failed`
            }
            const sideEffects: Array<number> = []
            let rejectionReason
            try {
                await sm.doForAllShards(shardIndex => {
                    // Fail on some of the shards.
                    if (shardIndex === 1 || shardIndex === 3) {
                        return Promise.reject(
                            new Error(errorMessage(shardIndex)),
                        )
                    } else {
                        sideEffects.push(shardIndex)
                        return Promise.resolve()
                    }
                }, {})
            } catch (error) {
                rejectionReason = error
            }
            expect([errorMessage(1), errorMessage(3)]).to.include(
                rejectionReason.message,
            )
            // Even though some shard operations failed, the remaining ones
            // should have executed and applied any side effects.
            expect(sideEffects).length(2)
            expect(sideEffects).to.include([0, 2])
        })
    })

    describe('pickRandomShard', () => {
        it('should pick valid shards', async () =>
            [
                sm.pickRandomShard(),
                sm.pickRandomShard(),
                sm.pickRandomShard(),
                sm.pickRandomShard(),
            ].forEach(randomShard => {
                expect([0, 1, 2, 3]).to.include(randomShard)
            }))
    })

    describe('getNumShards', () => {
        it('should know how to count', async () => {
            expect(sm.getNumShards()).to.equal(4)
        })
    })
})
