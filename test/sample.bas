' 测试各种大小写形式的关键字
GLOBAL DIM globalVar As Integer
dim localVar as STRING
Global Structure MyStruct
    field1 As Integer
    FIELD2 as String
End Structure

SUB TestFunction(BYREF param1 As Integer, byval param2 as String)
    LOCAL temp
    If param1 > 0 THEN
        dim result
        FOR i = 1 TO 10
            result = result + i
        NEXT
    ELSE
        While param1 < 0
            param1 = param1 + 1
        WEND
    END IF
END SUB

Function CalcValue(ByVal x as Integer) As Integer
    DIM result
    DO
        result = result + 1
    LOOP UNTIL result > x
    Return result
End Function