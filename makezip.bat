rem 
echo Remember: REMOVE LOG DEBUG
echo Remember: BUMP VERSION
pause
@echo on
del out\extension.zip
del /F/Q/S extension\dist
call npx tsc -b --verbose
cd extension
"C:\Program Files\7-Zip\7z" a -r -w -xr!*.map ..\out\extension.zip .
cd ..\out
del /F/Q/S ext-test
"C:\Program Files\7-Zip\7z" x extension.zip * -oext-test
cd ..
pause
