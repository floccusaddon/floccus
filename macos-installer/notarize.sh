xcrun notarytool submit bookmarkd-signed.pkg \
--apple-id "mklehr@gmx.net" \
--team-id "Marcel Klehr" \
--password "@keychain:AC_PASSWORD" \
--wait

xcrun stapler staple bookmarkd-signed.pkg
