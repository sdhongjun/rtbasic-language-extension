' RTBasic 示例代码
' 测试关键字大小写和多余空格处理

SUB main()
    DIM x AS INTEGER = 10
    DIM y AS INTEGER = 20

    IF x > y THEN
        print "x is greater than y"
    ELSE IF x < y THEN
        print "x is less than y"
    ELSE
        print "x is equal TO y"
    END IF

    WAIT IDLE
    WAIT UNTIL x > 30

    CALL test_function()
END SUB

FUNCTION test_function() AS INTEGER
    DIM result AS INTEGER = 0

    FOR i = 1 TO 10
        result = result + i
    NEXT

    IF result > 50 THEN
        EXIT FUNCTION
    END IF

    RETURN result
END FUNCTION

GLOBAL STRUCT Point
    x AS INTEGER
    y AS INTEGER
END STRUCT

GLOBAL FUNCTION Calculate(a AS INTEGER, b AS INTEGER) AS INTEGER
    RETURN a * b
END FUNCTION