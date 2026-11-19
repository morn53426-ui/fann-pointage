Vendored QR encoder

The JavaScript QRCode encoder files in this folder originate from qrcode-terminal 0.12.0's
vendor/QRCode folder. The contained QRCode implementation is Copyright (c) 2009 Kazuhiko Arase
and distributed under the MIT license; qrcode-terminal modifications are distributed under
Apache License 2.0. The original headers and license text are retained. See LICENSE-APACHE-2.0.txt.

FANN POINTAGE bundles these files locally to avoid sending dynamic attendance tokens to an
external QR generation service. web/vendor/qrcode.js is a small browser wrapper around them.
