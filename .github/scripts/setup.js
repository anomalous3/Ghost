const {spawn} = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const chalk = require('chalk');
const inquirer = require('inquirer');

/**
 * Run a command and stream output to the console
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object} options
 */
async function runAndStream(command, args, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: 'inherit',
            ...options
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(code);
            } else {
                reject(new Error(`'${command} ${args.join(' ')}' exited with code ${code}`));
            }
        });

    });
}

(async () => {
    if (process.env.NODE_ENV !== 'development') {
        console.log(chalk.yellow(`NODE_ENV is not development, skipping setup`));
        return;
    }

    if (process.env.DEVCONTAINER === 'true') {
        console.log(chalk.yellow(`Devcontainer detected, skipping setup`));
        return;
    }

    const coreFolder = path.join(__dirname, '../../ghost/core');
    const rootFolder = path.join(__dirname, '../..');
    const config = require('../../ghost/core/core/shared/config/loader').loadNconf({
        customConfigPath: coreFolder
    });

    const dbClient = config.get('database:client');
    const isUsingDocker = config.get('database:docker');

    // Only reset data if we are using Docker
    let resetData = false;
    let setupComplete = false;

    // Check for existing database configuration
    if (!dbClient || !dbClient.includes('mysql') && !dbClient.includes('sqlite')) {
        console.log(chalk.blue('No database configured. Setting up development database...'));
        
        // Check if Docker is available
        let dockerAvailable = false;
        try {
            await runAndStream('docker', ['--version'], {stdio: 'ignore'});
            dockerAvailable = true;
        } catch (err) {
            console.log(chalk.yellow('Docker not found - will use SQLite'));
        }

        let dbChoice = 'sqlite';
        if (dockerAvailable && !process.argv.includes('--sqlite')) {
            try {
                const response = await inquirer.prompt({
                    type: 'list',
                    name: 'database',
                    message: 'Choose database for development:',
                    choices: [
                        {name: 'SQLite (recommended for development)', value: 'sqlite'},
                        {name: 'MySQL via Docker', value: 'mysql'}
                    ],
                    default: 'sqlite'
                });
                dbChoice = response.database;
            } catch (err) {
                console.log(chalk.yellow('Interactive mode unavailable, using SQLite'));
                dbChoice = 'sqlite';
            }
        }

        if (dbChoice === 'sqlite') {
            console.log(chalk.blue('Setting up SQLite database...'));
            
            // Create SQLite configuration
            const configPath = path.join(coreFolder, 'config.development.json');
            const sqliteConfig = {
                enableDeveloperExperiments: true,
                database: {
                    client: 'sqlite3',
                    connection: {
                        filename: 'content/data/ghost-dev.db'
                    }
                },
                server: {
                    port: 2368,
                    host: '127.0.0.1'
                },
                url: 'http://localhost:2368'
            };

            try {
                await fs.writeFile(configPath, JSON.stringify(sqliteConfig, null, 4));
                console.log(chalk.green('SQLite configuration written to config.development.json'));
                
                // Ensure content/data directory exists
                const dataDir = path.join(coreFolder, 'content/data');
                await fs.mkdir(dataDir, {recursive: true});
                setupComplete = true;
            } catch (err) {
                console.error(chalk.red('Failed to create SQLite configuration'), err);
                process.exit(1);
            }
        } else {
            // MySQL setup
            let mysqlSetup = false;
            console.log(chalk.blue('Setting up MySQL via Docker...'));
            try {
                await runAndStream('yarn', ['docker:reset'], {cwd: path.join(__dirname, '../../')});
                mysqlSetup = true;
            } catch (err) {
                console.error(chalk.red('Failed to run MySQL Docker container'), err);
                console.error(chalk.red('Hint: is Docker installed and running?'));
                console.log(chalk.yellow('Falling back to SQLite...'));
                // Fallback to SQLite if Docker fails
                process.argv.push('--sqlite');
                return;
            }

            if (mysqlSetup) {
                resetData = true;
                console.log(chalk.blue('Adding MySQL credentials to config.local.json'));
                const currentConfigPath = path.join(coreFolder, 'config.local.json');

                let currentConfig;
                try {
                    currentConfig = require(currentConfigPath);
                } catch (err) {
                    currentConfig = {};
                }

                currentConfig.database = {
                    client: 'mysql',
                    docker: true,
                    connection: {
                        host: '127.0.0.1',
                        user: 'root',
                        password: 'root',
                        database: 'ghost'
                    }
                };

                try {
                    await fs.writeFile(currentConfigPath, JSON.stringify(currentConfig, null, 4));
                    setupComplete = true;
                } catch (err) {
                    console.error(chalk.red('Failed to write config.local.json'), err);
                    console.log(chalk.yellow('Please add the following to config.local.json:\n'), JSON.stringify(currentConfig, null, 4));
                    process.exit(1);
                }
            }
        }
    } else {
        if (isUsingDocker) {
            const yesAll = process.argv.includes('-y');
            const noAll = process.argv.includes('-n');
            const {confirmed} =
                yesAll ? {confirmed: true}
                : (
                    noAll ? {confirmed: false}
                    : await inquirer.prompt({name: 'confirmed', type:'confirm', message: 'MySQL is running via Docker, do you want to reset the Docker container? This will delete all existing data.', default: false})
                );

            if (confirmed) {
                console.log(chalk.yellow(`Resetting Docker container`));

                try {
                    await runAndStream('yarn', ['docker:reset'], {cwd: path.join(__dirname, '../../')});
                    resetData = true;
                } catch (err) {
                    console.error(chalk.red('Failed to run MySQL Docker container'), err);
                    console.error(chalk.red('Hint: is Docker installed and running?'));
                }
            }
        } else {
            console.log(chalk.green(`MySQL already configured locally. Stop your local database and delete your "database" configuration in config.local.json to switch to Docker.`));
        }
    }

    console.log(chalk.blue('Running knex-migrator init'));
    await runAndStream('yarn', ['knex-migrator', 'init'], {cwd: coreFolder});
    
    console.log(chalk.blue('Building admin interface and apps...'));
    await runAndStream('yarn', ['build'], {cwd: path.join(__dirname, '../../')});
    if (process.argv.includes('--no-seed')) {
        console.log(chalk.yellow(`Skipping seed data`));
        console.log(chalk.yellow(`Done`));
        return;
    }
    if (resetData) {
        const xxl = process.argv.includes('--xxl');

        if (xxl) {
            console.log(chalk.blue(`Resetting all data (with xxl)`));
            await runAndStream('yarn', ['reset:data:xxl'], {cwd: rootFolder});
        } else {
            console.log(chalk.blue(`Resetting all data`));
            await runAndStream('yarn', ['reset:data'], {cwd: rootFolder});
        }
    }
})();
