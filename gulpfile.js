const { src, dest, parallel } = require('gulp');

function copyIcons() {
    return src('nodes/**/*.svg').pipe(dest('dist/nodes'));
}

function copyJson() {
    return src('nodes/**/*.json').pipe(dest('dist/nodes'));
}

exports.default = parallel(copyIcons, copyJson);
exports.build = parallel(copyIcons, copyJson);