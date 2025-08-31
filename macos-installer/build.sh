pkgbuild \
--identifier org.handmadeideas.floccus-macos.installer \
--install-location "$HOME/Library/PrivilegedHelperTools" \
--scripts scripts \
--root payload \
bookmarkd.pkg

productbuild \
--sign "Developer ID Installer: Marcel Klehr" \
--package bookmarkd.pkg \
bookmarkd-signed.pkg
