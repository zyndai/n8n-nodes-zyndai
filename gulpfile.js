const { src, dest, parallel } = require('gulp');

function copyNodeIcons() {
    return src('nodes/**/*.svg').pipe(dest('dist/nodes'));
}

function copyRootIcons() {
    return src('icons/**/*.{svg,png}').pipe(dest('dist/icons'));
}

function copyJson() {
    return src('nodes/**/*.json').pipe(dest('dist/nodes'));
}

exports.default = parallel(copyNodeIcons, copyRootIcons, copyJson);
exports.build = parallel(copyNodeIcons, copyRootIcons, copyJson);