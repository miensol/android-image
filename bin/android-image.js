#!/usr/bin/env node

var androidImage = require(__dirname + '/../lib/index'),
    originalArgv = process.argv,
    commands = {
        '9patch': function () {
            var argv = require('yargs')
                .example('android-image 9patch --input ./test/green_button.png --res-directory ./out', 'Generate nine patch for given input')
                .demand('i')
                .alias('i', 'input')
                .describe('i', 'input file')
                .demand('r')
                .alias('r', 'res-directory')
                .describe('r', 'resources directory containing drawables')
                .default('sd', 240)
                .alias('sd','source-density')
                .parse(originalArgv);
            androidImage['9patch']({
                input: argv.i,
                output: argv.r,
                sourceDensity: argv.sd
            });
        }
    };
if (originalArgv[0].match(/node$/)) {
    originalArgv.shift();
}
var commandName = originalArgv[1],
    command = commands[commandName];

if (!command) {
    console.error('Command not found', commandName, 'available commands: 9patch\nExample android-image 9patch ...');
    process.exit(1);
} else {
    command();
}

